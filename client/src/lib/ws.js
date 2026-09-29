import { useEffect, useRef, useState, useCallback } from "react";

/* Shared WebSocket to /ws. The session cookie authenticates the upgrade.
 * Subscriptions are reference counted so several components can watch
 * the same room at once. */

let ws = null;
let status = "connecting";
const subs = new Map(); // room -> Set<fn>
const listeners = new Set();
const queue = [];
let wantOpen = false;
let retry = 0;

function emit(msg) {
  for (const fn of [...listeners]) {
    try {
      fn(msg);
    } catch (e) {
      console.error("ws listener", e);
    }
  }
}

function push(msg) {
  for (const fn of [...subs.values()].flatMap((s) => [...s])) {
    try {
      fn(msg);
    } catch (e) {
      console.error("ws sub", e);
    }
  }
}

function open() {
  wantOpen = true;
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    retry = 0;
    status = "open";
    // re-subscribe every room we care about
    for (const room of subs.keys()) ws.send(JSON.stringify({ t: "sub", room }));
    flush();
  };
  ws.onmessage = (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    emit(m);
    push(m);
  };
  ws.onclose = () => {
    status = "closed";
    ws = null;
    if (wantOpen) {
      const delay = Math.min(8000, 500 * ++retry);
      setTimeout(open, delay);
    }
  };
  ws.onerror = () => ws?.close();
}

function flush() {
  while (queue.length && ws && ws.readyState === 1) ws.send(queue.shift());
}

export function send(obj) {
  const line = JSON.stringify(obj);
  if (ws && ws.readyState === 1) ws.send(line);
  else queue.push(line);
}

export function ensureSocket() {
  open();
}

/** Send `msg` whenever `room` is active; the room is subscribed for the component's lifetime. */
export function useRoom(room, onMsg) {
  const cb = useRef(onMsg);
  cb.current = onMsg;
  useEffect(() => {
    if (!room) return;
    open();
    const fn = (m) => cb.current?.(m);
    if (!subs.has(room)) subs.set(room, new Set());
    subs.get(room).add(fn);
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: "sub", room }));
    return () => {
      const set = subs.get(room);
      set?.delete(fn);
      if (set && set.size === 0) {
        subs.delete(room);
        if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: "unsub", room }));
      }
    };
  }, [room]);
}

/** Global messages (welcome / balance / feed / mp:list / err). */
export function useSocket(onMsg) {
  const cb = useRef(onMsg);
  cb.current = onMsg;
  useEffect(() => {
    open();
    const fn = (m) => cb.current?.(m);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
}

export function useSocketStatus() {
  const [s, setS] = useState(status);
  useEffect(() => {
    const id = setInterval(() => setS(status), 500);
    return () => clearInterval(id);
  }, []);
  return s;
}

export function useSocketBalance(initial, onBalance) {
  const [balance, setBalance] = useState(initial);
  const cb = useRef(onBalance);
  cb.current = onBalance;
  useEffect(() => setBalance(initial), [initial]);
  useSocket(
    useCallback((m) => {
      if (m.t === "balance") {
        setBalance(m.balance);
        cb.current?.(m.balance);
      }
    }, [])
  );
  return balance;
}
