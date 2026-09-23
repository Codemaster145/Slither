import '@fontsource-variable/dm-sans';
import '@fontsource-variable/space-grotesk';
import { io, type Socket } from 'socket.io-client';
import {
  BASE_MASS,
  SKINS,
  type ClientEvents,
  type ServerEvents,
  type JoinRequest,
  type JoinReply,
} from '../../shared/protocol';
import { Renderer } from './renderer';
import { AudioEngine } from './audio';
import './style.css';
import { markup } from './markup';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
document.querySelector('#app')!.innerHTML = markup;
const audio = new AudioEngine();
const renderer = new Renderer($('arena'));
let skin = Math.max(
  0,
  Math.min(SKINS.length - 1, Number(sessionStorage.getItem('luma-skin')) || 0),
);
$('name').setAttribute('value', sessionStorage.getItem('luma-name') ?? '');
function selectSkin(i: number) {
  skin = i;
  sessionStorage.setItem('luma-skin', String(i));
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
const socket: Socket<ServerEvents, ClientEvents> = io(
  import.meta.env.VITE_SERVER_URL || undefined,
  {
    transports: ['websocket', 'polling'],
    tryAllTransports: true,
    reconnection: true,
    reconnectionDelay: 700,
    reconnectionDelayMax: 3000,
    timeout: 8000,
  },
);
let playing = false,
  dead = false,
  pending = false,
  roomCode = '',
  lastRequest: JoinRequest | undefined,
  angle = 0,
  boost = false,
  previousScore = BASE_MASS,
  recovering = false,
  lastSnapshot = 0;
const modal = $<HTMLDialogElement>('modal'),
  death = $<HTMLDialogElement>('death');
function toast(message: string) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  setTimeout(() => ($('toast').hidden = true), 3200);
}
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
death.addEventListener('cancel', (e) => e.preventDefault());
function status(online: boolean) {
  $('status').textContent = online ? 'SERVER ONLINE' : 'SERVER OFFLINE';
  $('status-dot').classList.toggle('online', online);
}
function setBusy(value: boolean) {
  pending = value;
  for (const id of ['quick', 'create', 'join']) $<HTMLButtonElement>(id).disabled = value;
}
function showMenuError(message: string) {
  $('menu-error').hidden = false;
  $('menu-error').textContent = message;
}
function joined(reply: JoinReply, request: JoinRequest) {
  setBusy(false);
  if (!reply.ok) {
    if (recovering) {
      recovering = false;
      $('reconnect').hidden = true;
      backToMenu();
    }
    showMenuError(reply.error);
    return;
  }
  modal.close();
  death.close();
  $('menu-error').hidden = true;
  roomCode = reply.code;
  lastRequest = { ...request, mode: reply.private ? 'join' : 'public', code: reply.code };
  renderer.reset(reply.id);
  playing = true;
  dead = false;
  previousScore = BASE_MASS;
  $('menu').hidden = true;
  $('hud').hidden = false;
  $('reconnect').hidden = true;
  $('room-label').textContent = reply.private ? `PRIVATE · ${reply.code}` : 'PUBLIC ARENA';
  $('invite').hidden = !reply.private;
  if (recovering) {
    toast('Signal restored. A fresh coil is ready.');
    recovering = false;
  } else if (reply.private) toast(`Room ${reply.code} · Invite a friend with the copy button.`);
  audio.play('join');
}
function join(mode: JoinRequest['mode'], code?: string) {
  if (pending) return;
  audio.unlock();
  audio.play('click');
  if (!socket.connected) {
    showMenuError('The server is offline. We’re reconnecting — please try again shortly.');
    return;
  }
  const name = $<HTMLInputElement>('name').value.trim() || 'Wanderer';
  sessionStorage.setItem('luma-name', name);
  const request = { mode, name, skin, code };
  setBusy(true);
  socket.timeout(7000).emit('join', request, (err: Error | null, reply: JoinReply) => {
    if (err) {
      setBusy(false);
      showMenuError('The arena took too long to respond. Please try again.');
      return;
    }
    joined(reply, request);
  });
}
$('quick').onclick = () => join('public');
$('create').onclick = () => join('create');
function joinDialog(code = '') {
  openModal(
    `<span class="eyebrow">BETTER TOGETHER</span><h2>Your people. Your arena.</h2><p>Enter your friend’s six-digit room code to join their corner of the cosmos.</p><form id="join-form"><label class="field-label" for="code">ROOM CODE</label><input id="code" class="code-input" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required/><button class="primary" type="submit">Join the room <b>↗</b></button><p id="join-error" class="error" role="alert"></p></form>`,
  );
  $<HTMLInputElement>('code').value = code;
  $('join-form').onsubmit = (e) => {
    e.preventDefault();
    const value = $<HTMLInputElement>('code').value;
    modal.close();
    join('join', value);
  };
  setTimeout(() => $('code').focus(), 50);
}
$('join').onclick = () => joinDialog();
$('how').onclick = () =>
  openModal(
    `<span class="eyebrow">FIND YOUR FLOW</span><h2>Small coil. Big dreams.</h2><div class="instructions"><div><b>01</b><p><strong>Follow your curiosity.</strong>Point your mouse to steer. On a phone, drag anywhere in the arena.</p></div><div><b>02</b><p><strong>Chase the glow.</strong>Gather sparks to grow. Brighter pellets are worth more mass.</p></div><div><b>03</b><p><strong>Make your move.</strong>Hold Space or the mouse button to boost. Speed costs mass, so grow a little first.</p></div><div><b>04</b><p><strong>Mind the other coils.</strong>Touch another player’s body or the arena edge and your run ends. Your own tail is safe. A dotted halo protects newly spawned coils for 2.5 seconds.</p></div></div><p class="dialog-note">The arena is shared live with real people. Invite a friend if it feels quiet.</p>`,
  );
$('settings').onclick = () => {
  openModal(
    `<span class="eyebrow">SET THE MOOD</span><h2>Your kind of atmosphere.</h2><label class="slider-label" for="sound">Sound effects <output id="sound-value">${Math.round(audio.volume * 100)}%</output></label><input id="sound" type="range" min="0" max="1" step=".01" value="${audio.volume}"/><label class="slider-label" for="music">Ambient music <output id="music-value">${Math.round(audio.music * 100)}%</output></label><input id="music" type="range" min="0" max="1" step=".01" value="${audio.music}"/><label class="mute-label"><input type="checkbox" id="mute" ${audio.muted ? 'checked' : ''}/> Mute all audio</label><p class="dialog-note">A quiet, original synthesized soundtrack. Nothing to download.</p>`,
  );
  for (const key of ['sound', 'music'] as const)
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
function backToMenu() {
  socket.emit('leave');
  playing = false;
  dead = false;
  boost = false;
  recovering = false;
  lastRequest = undefined;
  setBusy(false);
  renderer.reset();
  death.close();
  $('menu').hidden = false;
  $('hud').hidden = true;
  $('reconnect').hidden = true;
}
$('leave').onclick = backToMenu;
$('back-menu').onclick = backToMenu;
$('cancel-reconnect').onclick = backToMenu;
$('respawn').onclick = () => {
  audio.unlock();
  boost = false;
  socket.timeout(5000).emit('respawn', (err: Error | null, ok: boolean) => {
    if (err || !ok) {
      toast('Couldn’t respawn yet. Try again in a moment.');
      return;
    }
    renderer.reset(socket.id!);
    dead = false;
    previousScore = BASE_MASS;
    death.close();
    audio.play('join');
  });
};
$('sound-toggle').onclick = () => {
  audio.muted = !audio.muted;
  audio.save();
  $('sound-toggle').textContent = audio.muted ? '∅' : '♪';
  toast(audio.muted ? 'Sound muted' : 'Sound on');
};
$('invite').onclick = async () => {
  const url = new URL(location.href);
  url.searchParams.set('room', roomCode);
  try {
    await navigator.clipboard.writeText(url.toString());
    toast(`Invite copied · Room ${roomCode}`);
  } catch {
    openModal(
      '<span class="eyebrow">INVITE A FRIEND</span><h2>Good company, great coils.</h2><p id="copy-code"></p><input id="copy-link" class="code-input" readonly/><p>Select and copy the invite link above.</p>',
    );
    $('copy-code').textContent = `Room code: ${roomCode}`;
    $<HTMLInputElement>('copy-link').value = url.toString();
    $<HTMLInputElement>('copy-link').select();
  }
};
socket.on('connect', () => {
  status(true);
  if (playing && lastRequest) {
    recovering = true;
    renderer.reset();
    const request = lastRequest;
    socket.timeout(7000).emit('join', request, (err: Error | null, reply: JoinReply) => {
      if (err) {
        backToMenu();
        showMenuError('The server restarted. Please join a new arena.');
      } else joined(reply, request);
    });
  }
});
socket.on('connect_error', () => {
  status(false);
  if (!playing) $('status').textContent = 'SERVER UNAVAILABLE';
});
socket.on('disconnect', () => {
  status(false);
  setBusy(false);
  boost = false;
  if (playing) {
    $('reconnect').hidden = false;
    death.close();
  }
});
socket.on('snapshot', (state) => {
  if (!playing) return;
  lastSnapshot = performance.now();
  renderer.push(state);
  $('score').textContent = state.score.toLocaleString();
  $('rank').textContent = state.rank ? String(state.rank) : '—';
  $('players').textContent = String(state.count);
  const me = state.snakes.find((p) => p.id === renderer.id);
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
    if (p.id === renderer.id) li.className = 'is-you';
    const rank = document.createElement('span');
    rank.textContent = String(i + 1).padStart(2, '0');
    const name = document.createElement('span');
    name.textContent = p.name + (p.id === renderer.id ? ' · you' : '');
    const score = document.createElement('b');
    score.textContent = p.score.toLocaleString();
    li.append(rank, name, score);
    list.append(li);
  });
});
socket.on('death', (data) => {
  dead = true;
  boost = false;
  document.body.classList.remove('boosting');
  $('death-score').textContent = data.score.toLocaleString();
  $('death-time').textContent =
    `${Math.floor(data.seconds / 60)}:${String(data.seconds % 60).padStart(2, '0')}`;
  $('death-reason').textContent = data.reason;
  death.showModal();
  audio.play('death');
});
window.addEventListener('pointermove', (e) => {
  if (playing && !dead && e.target !== $('touch-boost') && (e.pointerType !== 'touch' || e.buttons))
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
  if (e.code === 'Space' && playing && !dead) {
    e.preventDefault();
    boost = true;
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') boost = false;
});
window.addEventListener('blur', () => {
  boost = false;
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    boost = false;
    socket.emit('input', { angle, boost: false });
  }
});
$('touch-boost').onpointerdown = (e) => {
  e.preventDefault();
  boost = true;
};
setInterval(() => {
  if (playing && !dead && socket.connected) socket.emit('input', { angle, boost });
}, 1000 / 30);
setInterval(() => {
  if (socket.connected) {
    const start = performance.now();
    socket.timeout(3000).emit('latency', (err: Error | null) => {
      if (!err) $('ping').textContent = `${Math.round(performance.now() - start)} ms`;
    });
  }
  if (
    playing &&
    !dead &&
    lastSnapshot &&
    performance.now() - lastSnapshot > 4000 &&
    socket.connected
  ) {
    socket.disconnect();
    socket.connect();
  }
}, 2500);
const inviteCode = new URLSearchParams(location.search).get('room');
if (inviteCode && /^\d{6}$/.test(inviteCode)) joinDialog(inviteCode);
window.addEventListener('beforeunload', () => {
  renderer.destroy();
  socket.disconnect();
});
