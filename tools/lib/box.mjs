// The same locking the page uses (public/index.html): a key made from a PIN with PBKDF2-SHA256 scrambles
// JSON with AES-GCM, and a box is {salt, iv, iter, data} in base64.
import { webcrypto as wc, createHash } from "node:crypto";

const enc = new TextEncoder();
const b64 = bytes => Buffer.from(bytes).toString("base64");
const unb64 = text => new Uint8Array(Buffer.from(text, "base64"));

async function keyFrom(pin, salt, iter){
  const raw = await wc.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return wc.subtle.deriveKey({ name:"PBKDF2", salt, iterations:iter, hash:"SHA-256" }, raw, { name:"AES-GCM", length:256 }, false, ["encrypt", "decrypt"]);
}

export async function lockBox(obj, pin, iter = 300000){
  const salt = wc.getRandomValues(new Uint8Array(16)), iv = wc.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await wc.subtle.encrypt({ name:"AES-GCM", iv }, await keyFrom(pin, salt, iter), enc.encode(JSON.stringify(obj))));
  return { salt:b64(salt), iv:b64(iv), iter, data:b64(data) };
}

/* null when the PIN doesn't open the box */
export async function unlockBox(box, pin){
  try {
    const plain = await wc.subtle.decrypt({ name:"AES-GCM", iv:unb64(box.iv) }, await keyFrom(pin, unb64(box.salt), box.iter), unb64(box.data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch { return null; }
}

/* the staff key a coach PIN opens, or null */
export async function openStaffKey(playbook, coachPin){
  for (const c of playbook.coaches || []){
    const k = await unlockBox(c.box, coachPin);
    if (k && typeof k.k === "string") return k.k;
  }
  return null;
}

export const staffKeyHash = key => createHash("sha256").update(key).digest("hex");
export const newStaffKey = () => b64(wc.getRandomValues(new Uint8Array(32)));
export const newRev = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
