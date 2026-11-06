// Passwords — bcryptjs, same lib 9router already ships.
import bcrypt from "bcryptjs";

const ROUNDS = 12;

export async function hashPassword(plain) {
  return bcrypt.hash(String(plain), ROUNDS);
}

export async function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  return bcrypt.compare(String(plain), String(hash));
}

export function passwordPolicyError(plain) {
  if (!plain || typeof plain !== "string") return "Password is required";
  if (plain.length < 8) return "Password must be at least 8 characters";
  return null;
}
