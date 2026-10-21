/**
 * The simulated customer "holding the phone" on the WhatsApp portal.
 * Stored in localStorage so each browser keeps its own customer.
 */
import { useEffect, useState } from "react";

export type WaProfile = { name: string; phone: string };

const PROFILE_KEY = "qc.wa.profile";
const SEEN_KEY = "qc.wa.seen";

/** Demo customers, matching the sample messages' names. */
export const demoCustomers = [
	"Encik Hafiz",
	"陈小姐",
	"Priya",
	"Kak Ros",
	"Mr. Tan",
	"Puan Salmah",
	"黄先生",
	"Jess",
];

/** A stable, fake Malaysian mobile number derived from the name. */
export function phoneFor(name: string) {
	let h = 7;
	for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
	const digits = String(h).padStart(10, "0");
	return `+60 1${digits[0]}-${digits.slice(1, 4)} ${digits.slice(4, 8)}`;
}

export function makeProfile(name: string): WaProfile {
	return { name, phone: phoneFor(name) };
}

function read<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
}

function write(key: string, value: unknown) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Storage can be unavailable (private mode); the demo still works.
	}
}

/** Returns null until mounted, so server and client render the same thing. */
export function useWaProfile() {
	const [profile, setProfile] = useState<WaProfile | null>(null);
	useEffect(() => {
		setProfile(read(PROFILE_KEY, makeProfile(demoCustomers[0])));
	}, []);
	return [
		profile,
		(next: WaProfile) => {
			write(PROFILE_KEY, next);
			setProfile(next);
		},
	] as const;
}

/** When each conversation was last opened, for unread counts. */
export function useSeen() {
	const [seen, setSeen] = useState<Record<string, string>>({});
	useEffect(() => setSeen(read(SEEN_KEY, {})), []);
	return [
		seen,
		(conversationId: string) => {
			setSeen((prev) => {
				const next = { ...prev, [conversationId]: new Date().toISOString() };
				write(SEEN_KEY, next);
				return next;
			});
		},
	] as const;
}
