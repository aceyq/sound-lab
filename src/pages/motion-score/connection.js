// Phone ↔ laptop data connection over WebRTC, using PeerJS.
//
// How pairing works: both pages connect to PeerJS's free public signaling
// server (0.peerjs.com) only to find each other. The laptop registers under a
// random session ID; the phone asks the server to introduce it to that ID.
// After that, sensor data flows directly between the two devices over a
// WebRTC data channel (or through a relay if a direct path is impossible).
//
// ICE servers: this app uses PeerJS 1.5.5's built-in defaults: Google's
// public STUN server and PeerJS's public TURN relays (eu-0 / us-0
// .turn.peerjs.com). They are free, best-effort services with no guarantee;
// this app does not run or configure a TURN relay of its own. Some school or
// corporate networks block WebRTC entirely; use Laptop Demo in that case.
//
// Security: the pairing code is checked before a phone may control anything,
// only one phone is accepted at a time, and every message is validated. This
// is fine for a classroom instrument, not for sensitive data.

import { Peer } from 'peerjs';
import { peerIdFor, validatePhoneMessage, validateLaptopMessage, PROTOCOL_VERSION, newSession } from './protocol.js';

const OPEN_TIMEOUT_MS = 12000;
const HELLO_TIMEOUT_MS = 6000;
const SILENCE_LOST_MS = 4000; // no message at all for this long → connection lost
const HEARTBEAT_MS = 1000;
const MAX_BUFFERED = 64 * 1024; // drop outgoing messages instead of queueing forever

function friendlyPeerError(err, side) {
  const type = err && err.type;
  if (type === 'peer-unavailable') {
    return side === 'phone'
      ? 'Laptop session not found. Check the session ID and code, or press New Session on the laptop and scan the new QR code.'
      : 'The phone could not be reached.';
  }
  if (type === 'network' || type === 'socket-error' || type === 'socket-closed' || type === 'server-error') {
    return 'Could not reach the pairing server (0.peerjs.com). Check the internet connection, then try again.';
  }
  if (type === 'browser-incompatible') return 'This browser does not support WebRTC data connections. Try Chrome or Safari.';
  if (type === 'webrtc') return 'The direct connection failed. The network may block WebRTC. Try another network, or use Laptop Demo.';
  return `Connection error (${type || (err && err.message) || 'unknown'}). Try again.`;
}

/** Laptop side: owns the session and accepts exactly one controller. */
export class SessionHost {
  constructor({ onState, onMessage } = {}) {
    this.onState = onState || (() => {});
    this.onMessage = onMessage || (() => {});
    this.state = 'idle'; // idle | creating | waiting | connected | failed | lost
    this.detail = '';
    this.session = null;
    this.peer = null;
    this.conn = null;
    this.stats = { received: 0, rejectedMessages: 0, rejectedPhones: 0, lastError: '' };
    this.timers = [];
  }

  _set(state, detail = '') {
    this.state = state;
    this.detail = detail;
    this.onState(state, detail);
  }

  _timer(fn, ms, interval = false) {
    const id = interval ? setInterval(fn, ms) : setTimeout(fn, ms);
    this.timers.push([id, interval]);
    return id;
  }

  /** Create a new session (closing any previous one). */
  start() {
    this.close();
    this.closed = false;
    this.session = newSession();
    this.stats = { received: 0, rejectedMessages: 0, rejectedPhones: 0, lastError: '' };
    this._set('creating');
    let peer;
    try {
      peer = new Peer(peerIdFor(this.session.sessionId), { debug: 0 });
    } catch (err) {
      this._set('failed', friendlyPeerError(err, 'laptop'));
      return;
    }
    this.peer = peer;
    const openTimer = this._timer(() => {
      if (this.state === 'creating') this._fail('Timed out reaching the pairing server (0.peerjs.com). Check the internet connection, then press New Session.');
    }, OPEN_TIMEOUT_MS);
    peer.on('open', () => {
      clearTimeout(openTimer);
      if (this.peer === peer && this.state === 'creating') this._set('waiting');
    });
    peer.on('connection', (conn) => this._incoming(conn));
    peer.on('disconnected', () => {
      // Lost the signaling server only; an existing phone link keeps working.
      if (this.peer === peer && !this.closed && !peer.destroyed) {
        try { peer.reconnect(); } catch { /* ignore */ }
      }
    });
    peer.on('error', (err) => {
      this.stats.lastError = err.type || String(err);
      if (this.peer !== peer) return;
      if (err.type === 'unavailable-id') {
        this.start(); // astronomically unlikely: pick a new random ID
        return;
      }
      if (this.state === 'creating' || this.state === 'waiting') this._fail(friendlyPeerError(err, 'laptop'));
    });
    this._timer(() => this._heartbeat(), HEARTBEAT_MS, true);
  }

  _fail(detail) {
    this._dropConn();
    this._set('failed', detail);
  }

  _incoming(conn) {
    if (this.conn) {
      // Only one controller: tell the newcomer and hang up.
      this.stats.rejectedPhones++;
      conn.on('open', () => {
        try { conn.send({ type: 'reject', reason: 'Another phone is already connected to this laptop session.' }); } catch { /* ignore */ }
        setTimeout(() => conn.close(), 500);
      });
      return;
    }
    this.conn = conn;
    this.authed = false;
    this.lastHeard = performance.now();
    const helloTimer = this._timer(() => {
      if (this.conn === conn && !this.authed) {
        this.stats.rejectedPhones++;
        this._dropConn();
        if (this.state !== 'connected') this._set('waiting');
      }
    }, HELLO_TIMEOUT_MS);
    conn.on('data', (data) => {
      if (this.conn !== conn) return;
      this.lastHeard = performance.now();
      const v = validatePhoneMessage(data);
      if (!v.ok) {
        this.stats.rejectedMessages++;
        return;
      }
      const msg = v.msg;
      if (!this.authed) {
        if (msg.type === 'hello' && msg.code === this.session.token) {
          clearTimeout(helloTimer);
          this.authed = true;
          this._send({ type: 'welcome' });
          this._set('connected');
        } else {
          this.stats.rejectedPhones++;
          try { conn.send({ type: 'reject', reason: 'Wrong pairing code. Scan the QR code on the laptop again.' }); } catch { /* ignore */ }
          setTimeout(() => conn.close(), 300);
          this.conn = null;
        }
        return;
      }
      this.stats.received++;
      this.onMessage(msg);
    });
    conn.on('close', () => {
      if (this.conn !== conn) return;
      const was = this.authed;
      this.conn = null;
      this.authed = false;
      if (was && !this.closed) this._set('lost', 'The phone disconnected. Keep the phone page open, or reload it to reconnect.');
    });
    conn.on('error', () => { /* followed by close */ });
  }

  _heartbeat() {
    if (!this.conn || !this.authed) return;
    this._send({ type: 'ping' });
    if (performance.now() - this.lastHeard > SILENCE_LOST_MS) {
      this._dropConn();
      this._set('lost', 'No messages from the phone for 4 seconds. Check that the phone page is open and unlocked, then reload it.');
    }
  }

  _send(msg) {
    const c = this.conn;
    if (!c || !c.open) return false;
    const dc = c.dataChannel;
    if (dc && dc.bufferedAmount > MAX_BUFFERED) return false;
    try {
      c.send(msg);
      return true;
    } catch {
      return false;
    }
  }

  /** Send a state update to the phone (dropped if not connected). */
  send(msg) {
    if (this.authed) this._send(msg);
  }

  _dropConn() {
    const c = this.conn;
    this.conn = null;
    this.authed = false;
    if (c) try { c.close(); } catch { /* ignore */ }
  }

  close() {
    this.closed = true;
    for (const [id, interval] of this.timers) (interval ? clearInterval : clearTimeout)(id);
    this.timers = [];
    this._dropConn();
    if (this.peer) {
      const p = this.peer;
      this.peer = null;
      try { p.destroy(); } catch { /* ignore */ }
    }
    this.state = 'idle';
  }
}

/** Phone side: connects to the laptop session and sends sensor messages. */
export class SessionClient {
  constructor({ onState, onMessage } = {}) {
    this.onState = onState || (() => {});
    this.onMessage = onMessage || (() => {});
    this.state = 'idle'; // idle | connecting | connected | rejected | failed | lost
    this.detail = '';
    this.timers = [];
    this.dropped = 0;
  }

  _set(state, detail = '') {
    this.state = state;
    this.detail = detail;
    this.onState(state, detail);
  }

  connect(sessionId, code) {
    this.close();
    this.closed = false;
    this._set('connecting');
    let peer;
    try {
      peer = new Peer({ debug: 0 });
    } catch (err) {
      this._set('failed', friendlyPeerError(err, 'phone'));
      return;
    }
    this.peer = peer;
    const timeout = setTimeout(() => {
      if (this.state === 'connecting') this._fail('Timed out connecting to the laptop. Check that the laptop page shows "Waiting for phone", then tap Try Again.');
    }, 15000);
    this.timers.push([timeout, false]);
    peer.on('open', () => {
      if (this.peer !== peer) return;
      const conn = peer.connect(peerIdFor(sessionId), { reliable: true, serialization: 'json' });
      this.conn = conn;
      conn.on('open', () => {
        try { conn.send({ type: 'hello', v: PROTOCOL_VERSION, code }); } catch { /* ignore */ }
      });
      conn.on('data', (data) => {
        const v = validateLaptopMessage(data);
        if (!v.ok) return;
        this.lastHeard = performance.now();
        if (v.msg.type === 'welcome') {
          clearTimeout(timeout);
          this._set('connected');
        } else if (v.msg.type === 'reject') {
          clearTimeout(timeout);
          this._set('rejected', v.msg.reason);
          this._drop();
        } else this.onMessage(v.msg);
      });
      conn.on('close', () => {
        if (this.conn !== conn || this.closed) return;
        this.conn = null;
        if (this.state === 'connected') this._set('lost', 'The laptop closed the connection. Check the laptop page, then tap Try Again.');
        else if (this.state === 'connecting') this._fail('The laptop did not accept the connection. Check the code and tap Try Again.');
      });
    });
    peer.on('disconnected', () => {
      if (this.peer === peer && !this.closed && !peer.destroyed) try { peer.reconnect(); } catch { /* ignore */ }
    });
    peer.on('error', (err) => {
      if (this.peer !== peer) return;
      if (this.state === 'connecting') this._fail(friendlyPeerError(err, 'phone'));
    });
    const hb = setInterval(() => {
      if (this.state !== 'connected') return;
      this.send({ type: 'ping' });
      if (performance.now() - (this.lastHeard || 0) > SILENCE_LOST_MS) {
        this._drop();
        this._set('lost', 'No messages from the laptop for 4 seconds. Check the laptop page and Wi-Fi, then tap Try Again.');
      }
    }, HEARTBEAT_MS);
    this.timers.push([hb, true]);
  }

  _fail(detail) {
    this._drop();
    this._set('failed', detail);
  }

  /** Send a message if connected; drops it when the channel is backed up. */
  send(msg) {
    const c = this.conn;
    if (!c || !c.open || this.state !== 'connected' && msg.type !== 'hello') return false;
    const dc = c.dataChannel;
    if (dc && dc.bufferedAmount > MAX_BUFFERED) {
      this.dropped++;
      return false;
    }
    try {
      c.send(msg);
      return true;
    } catch {
      return false;
    }
  }

  _drop() {
    const c = this.conn;
    this.conn = null;
    if (c) try { c.close(); } catch { /* ignore */ }
  }

  close() {
    this.closed = true;
    for (const [id, interval] of this.timers) (interval ? clearInterval : clearTimeout)(id);
    this.timers = [];
    this._drop();
    if (this.peer) {
      const p = this.peer;
      this.peer = null;
      try { p.destroy(); } catch { /* ignore */ }
    }
  }
}
