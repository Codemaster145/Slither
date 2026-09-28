import '@fontsource-variable/dm-sans';
import '@fontsource-variable/space-grotesk';
import { BASE_MASS, SKINS, type Snapshot } from '../../shared/protocol';
import type { Difficulty, GameConfig } from '../../shared/local-game';
import type { Command, GameEvent } from '../../shared/worker-protocol';
import { Renderer } from './renderer';
import { AudioEngine } from './audio';
import { markup } from './markup';
import './style.css';
import './site.css';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
document.querySelector('#app')!.innerHTML = markup;
const audio = new AudioEngine(),
  renderer = new Renderer($('arena'));
const read = (key: string, fallback = '') => {
  try {
    return sessionStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, value: string) => {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* Storage is optional. */
  }
};
let stats = { score: 0, rank: 0, seconds: 0, games: 0 };
try {
  const stored = JSON.parse(read('luma-session', '{}'));
  for (const key of Object.keys(stats) as (keyof typeof stats)[])
    if (Number.isFinite(stored[key]) && stored[key] >= 0) stats[key] = stored[key];
} catch {
  /* Fresh session. */
}
const title = (s: string) => s[0].toUpperCase() + s.slice(1);
const time = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
function sessionStats() {
  $('session-stats').innerHTML =
    `<div><strong>${stats.score}</strong><span>BEST SCORE</span></div><div><strong>${stats.rank ? '#' + stats.rank : '—'}</strong><span>BEST RANK</span></div><div><strong>${time(stats.seconds)}</strong><span>LONGEST RUN</span></div><div><strong>${stats.games}</strong><span>RUNS PLAYED</span></div>`;
  save('luma-session', JSON.stringify(stats));
}
sessionStats();
let skin = Math.max(0, Math.min(SKINS.length - 1, Number(read('luma-skin')) || 0));
$<HTMLInputElement>('name').value = read('luma-name');
function selectSkin(i: number) {
  skin = i;
  save('luma-skin', String(i));
  renderer.skin = i;
  $('skin-name').textContent = SKINS[i].name;
  document.querySelector('.hero-index')!.textContent =
    `00${i + 1} / ${SKINS[i].name.toUpperCase()}`;
  document.querySelectorAll('.skin').forEach((e, n) => {
    e.classList.toggle('selected', n === i);
    e.setAttribute('aria-pressed', String(n === i));
  });
}
SKINS.forEach((s, i) => {
  const button = document.createElement('button');
  button.className = 'skin';
  button.title = `${s.name} — ${s.description}`;
  button.setAttribute('aria-label', `${s.name} skin`);
  button.style.setProperty('--skin', s.colors[0]);
  button.style.setProperty('--shade', s.colors[1]);
  button.innerHTML = '<span class="mini-coil"><i></i></span>';
  button.onclick = () => {
    selectSkin(i);
    audio.play('click');
  };
  $('skins').append(button);
});
selectSkin(skin);
const descriptions: Record<Difficulty, string> = {
  easy: 'Room to grow. Relaxed reactions, wandering turns and rare boosts.',
  normal: 'A friendly challenge. Food seekers with a few tricks up their sleeves.',
  hard: 'Stay sharp. Fast reactions, predicted paths and daring cutoffs.',
  expert: 'Every turn matters. Escape planning, clever cutoffs and precise boosts.',
  mixed: 'A little of everyone. Mostly Normal, with Easy, Hard and a few Experts.',
};
let custom = false,
  difficulty: Difficulty = 'normal',
  count: 10 | 20 | 30 = 20;
for (const key of Object.keys(descriptions) as Difficulty[]) {
  const b = document.createElement('button');
  b.textContent = title(key);
  b.dataset.difficulty = key;
  b.onclick = () => {
    difficulty = key;
    selection();
  };
  $('difficulties').append(b);
}
for (const n of [10, 20, 30] as const) {
  const b = document.createElement('button');
  b.textContent = String(n);
  b.dataset.count = String(n);
  b.onclick = () => {
    count = n;
    selection();
  };
  $('counts').append(b);
}
function selection() {
  $('custom-options').hidden = !custom;
  for (const [id, on] of [
    ['mode-quick', !custom],
    ['mode-custom', custom],
  ] as const) {
    $(id).classList.toggle('selected', on);
    $(id).setAttribute('aria-pressed', String(on));
  }
  $('chosen-difficulty').textContent = title(custom ? difficulty : 'normal');
  $('chosen-count').textContent = String(custom ? count : 20);
  $('difficulty-note').textContent = descriptions[difficulty];
  document.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach((b) => {
    const on = b.dataset.difficulty === difficulty;
    b.classList.toggle('selected', on);
    b.setAttribute('aria-pressed', String(on));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-count]').forEach((b) => {
    const on = b.dataset.count === String(count);
    b.classList.toggle('selected', on);
    b.setAttribute('aria-pressed', String(on));
  });
}
$('mode-quick').onclick = () => {
  custom = false;
  selection();
};
$('mode-custom').onclick = () => {
  custom = true;
  selection();
};
selection();
let worker: Worker | undefined,
  playing = false,
  dead = false,
  paused = false,
  angle = 0,
  boost = false,
  previousScore = BASE_MASS,
  config: GameConfig,
  latest: Snapshot | undefined;
const modal = $<HTMLDialogElement>('modal'),
  death = $<HTMLDialogElement>('death'),
  pauseDialog = $<HTMLDialogElement>('pause-dialog');
const send = (command: Command) => worker?.postMessage(command);
function updateStats(score: number, rank: number, seconds: number) {
  stats.score = Math.max(stats.score, score);
  if (rank > 0) stats.rank = stats.rank ? Math.min(stats.rank, rank) : rank;
  stats.seconds = Math.max(stats.seconds, seconds);
}
function newLife() {
  dead = false;
  boost = false;
  previousScore = BASE_MASS;
  renderer.reset('you');
  death.close();
  stats.games++;
  sessionStats();
  audio.play('join');
}
function start() {
  worker?.terminate();
  audio.unlock();
  config = {
    name: $<HTMLInputElement>('name').value.trim() || 'Wanderer',
    skin,
    difficulty: custom ? difficulty : 'normal',
    count: custom ? count : 20,
  };
  save('luma-name', config.name);
  $('menu-error').hidden = true;
  $<HTMLButtonElement>('quick').disabled = true;
  worker = new Worker(new URL('./game-worker.ts', import.meta.url), { type: 'module' });
  worker.onerror = () => {
    backToMenu();
    $('menu-error').textContent = 'The arena couldn’t start. Please try again.';
    $('menu-error').hidden = false;
  };
  worker.onmessage = (e: MessageEvent<GameEvent>) => {
    const event = e.data;
    if (event.type === 'ready') {
      playing = true;
      paused = false;
      latest = undefined;
      newLife();
      $('menu').hidden = true;
      $('hud').hidden = false;
      $('room-label').textContent =
        `${title(config.difficulty).toUpperCase()} · ${config.count} AI`;
      $<HTMLButtonElement>('quick').disabled = false;
    }
    if (event.type === 'respawned') newLife();
    if (event.type === 'snapshot') {
      latest = event.state;
      renderState(event.state, event.seconds);
    }
    if (event.type === 'death') {
      dead = true;
      boost = false;
      document.body.classList.remove('boosting');
      const d = event.data;
      $('death-score').textContent = String(d.score);
      $('death-rank').textContent = '#' + d.rank;
      $('death-time').textContent = time(d.seconds);
      $('death-food').textContent = String(d.foodEaten);
      $('death-peak').textContent = String(d.peakMass);
      $('death-difficulty').textContent = title(config.difficulty);
      $('death-reason').textContent = d.reason;
      updateStats(d.peakMass ?? d.score, d.rank ?? 0, d.seconds);
      sessionStats();
      death.showModal();
      audio.play('death');
    }
  };
  send({ type: 'start', config });
}
$('quick').onclick = start;
function renderState(state: Snapshot, seconds: number) {
  renderer.push(state);
  $('score').textContent = state.score.toLocaleString();
  $('rank').textContent = state.rank ? String(state.rank) : '—';
  $('players').textContent = String(state.count);
  $('population').textContent = `YOU + ${state.botCount} AI`;
  $('time').textContent = time(seconds);
  updateStats(state.score, state.rank, seconds);
  const me = state.snakes.find((p) => p.id === 'you');
  if (me) {
    if (me.mass > previousScore) audio.play('eat');
    if (me.boost && !document.body.classList.contains('boosting')) audio.play('boost');
    previousScore = me.mass;
    document.body.classList.toggle('boosting', me.boost);
    $('boost-fill').style.width = `${Math.min(100, Math.max(0, me.mass - BASE_MASS) * 2)}%`;
    $('boost-label').textContent =
      me.mass <= BASE_MASS + 4
        ? 'COLLECT SPARKS TO UNLOCK BOOST'
        : me.boost
          ? 'LET IT GLOW · BOOSTING'
          : 'HOLD SPACE OR CLICK TO BOOST';
  }
  const list = $('leaders');
  list.replaceChildren();
  state.leaders.forEach((p, i) => {
    const li = document.createElement('li');
    if (p.id === 'you') li.className = 'is-you';
    const rank = document.createElement('span'),
      name = document.createElement('span'),
      score = document.createElement('b');
    rank.textContent = String(i + 1).padStart(2, '0');
    name.textContent = p.name + (p.id === 'you' ? ' · you' : '');
    score.textContent = p.score.toLocaleString();
    li.append(rank, name, score);
    list.append(li);
  });
}
function backToMenu() {
  worker?.terminate();
  worker = undefined;
  playing = false;
  dead = false;
  paused = false;
  boost = false;
  latest = undefined;
  renderer.reset();
  death.close();
  pauseDialog.close();
  $('menu').hidden = false;
  $('hud').hidden = true;
  document.body.classList.remove('boosting');
  $<HTMLButtonElement>('quick').disabled = false;
  sessionStats();
}
for (const id of ['leave', 'back-menu', 'pause-menu']) $(id).onclick = backToMenu;
$('respawn').onclick = () => {
  audio.unlock();
  send({ type: 'respawn' });
};
function pause(value: boolean) {
  if (!playing || dead) return;
  paused = value;
  boost = false;
  send({ type: 'pause', paused });
  if (value) pauseDialog.showModal();
  else pauseDialog.close();
}
$('pause').onclick = () => pause(true);
$('resume').onclick = () => pause(false);
pauseDialog.addEventListener('cancel', (e) => {
  e.preventDefault();
  pause(false);
});
death.addEventListener('cancel', (e) => e.preventDefault());
function openModal(html: string) {
  $('modal-content').innerHTML = html;
  modal.showModal();
  audio.unlock();
  audio.play('click');
}
$('modal-close').onclick = () => modal.close();
modal.addEventListener('click', (e) => {
  if (e.target === modal) modal.close();
});
$('how').onclick = () =>
  openModal(
    `<span class="eyebrow">FIND YOUR FLOW</span><h2>Small coil. Big dreams.</h2><div class="instructions"><div><b>01</b><p><strong>Follow your curiosity.</strong>Point your mouse to steer. On a phone, drag anywhere in the arena.</p></div><div><b>02</b><p><strong>Chase the glow.</strong>Gather sparks to grow. Brighter pellets are worth more mass.</p></div><div><b>03</b><p><strong>Make your move.</strong>Hold Space, the mouse button, or the touch Boost button. Boost spends mass. Gather a few sparks first.</p></div><div><b>04</b><p><strong>Mind the other coils.</strong>Touch another coil’s body or the arena edge and your run ends. Your own tail is safe. A dotted halo protects new coils for 2.5 seconds.</p></div></div><p class="dialog-note">Every opponent is AI. Quick Play uses Normal difficulty and 20 AI; Custom Game lets you set the challenge. Press Esc to pause. Changing tabs pauses your arena.</p>`,
  );
$('settings').onclick = () => {
  openModal(
    `<span class="eyebrow">SET THE MOOD</span><h2>Your kind of atmosphere.</h2><label class="slider-label" for="sound">Sound effects <output id="sound-value">${Math.round(audio.volume * 100)}%</output></label><input id="sound" type="range" min="0" max="1" step=".01" value="${audio.volume}"/><label class="slider-label" for="music">Ambient music <output id="music-value">${Math.round(audio.music * 100)}%</output></label><input id="music" type="range" min="0" max="1" step=".01" value="${audio.music}"/><label class="mute-label"><input type="checkbox" id="mute" ${audio.muted ? 'checked' : ''}/> Mute all audio</label><p class="dialog-note">Original synthesized sounds. Your preferences stay on this device.</p>`,
  );
  for (const key of ['sound', 'music'])
    $<HTMLInputElement>(key).oninput = (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      if (key === 'sound') audio.volume = v;
      else audio.music = v;
      $(key + '-value').textContent = `${Math.round(v * 100)}%`;
      audio.save();
    };
  $<HTMLInputElement>('mute').onchange = (e) => {
    audio.muted = (e.target as HTMLInputElement).checked;
    audio.save();
  };
};
$('sound-toggle').onclick = () => {
  audio.muted = !audio.muted;
  audio.save();
  $('sound-toggle').textContent = audio.muted ? '∅' : '♪';
};
window.addEventListener('pointermove', (e) => {
  if (
    playing &&
    !dead &&
    !paused &&
    e.target !== $('touch-boost') &&
    (e.pointerType !== 'touch' || e.buttons)
  )
    angle = Math.atan2(e.clientY - innerHeight / 2, e.clientX - innerWidth / 2);
});
$('arena').addEventListener('pointerdown', (e) => {
  audio.unlock();
  if (e.pointerType === 'mouse' && e.button === 0) boost = true;
  else angle = Math.atan2(e.clientY - innerHeight / 2, e.clientX - innerWidth / 2);
});
window.addEventListener('pointerup', () => (boost = false));
window.addEventListener('pointercancel', () => (boost = false));
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && playing && !dead && !paused) {
    e.preventDefault();
    boost = true;
  }
  if (e.code === 'Escape' && playing && !dead) {
    e.preventDefault();
    if (!e.repeat) pause(!paused);
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') boost = false;
});
window.addEventListener('blur', () => (boost = false));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && playing && !dead && !paused) pause(true);
});
$('touch-boost').onpointerdown = (e) => {
  e.preventDefault();
  boost = true;
};
setInterval(() => {
  if (playing && !dead && !paused) send({ type: 'input', angle, boost });
}, 1000 / 30);
window.addEventListener('beforeunload', () => {
  sessionStats();
  renderer.destroy();
  worker?.terminate();
});
// Optional ChatGPT agent read-back shares the exact state displayed in the HUD.
const context = (
  document as Document & {
    modelContext?: { registerTool: (tool: unknown, options: unknown) => unknown };
  }
).modelContext;
const lifecycle = new AbortController();
if (context?.registerTool) {
  try {
    Promise.resolve(
      context.registerTool(
        {
          name: 'read_arena_status',
          description: 'Read the current Luma Coil menu or live arena status and session records.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute(input: unknown) {
            if (!input || typeof input !== 'object' || Object.keys(input).length)
              throw new Error('Expected an empty object');
            return {
              playing,
              paused,
              dead,
              difficulty: playing ? config.difficulty : custom ? difficulty : 'normal',
              aiCount: playing ? config.count : custom ? count : 20,
              score: latest?.score ?? 0,
              rank: latest?.rank ?? 0,
              stats: { ...stats },
            };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
  } catch {
    /* Optional browser API. */
  }
}
window.addEventListener('pagehide', () => lifecycle.abort());
