// Lightweight immutable SvelteSet helper
// Use immutable operations so Svelte reactivity triggers when the variable is reassigned.
export class SvelteSet<T> {
	private readonly items: Set<T>;

	constructor(iterable?: Iterable<T>) {
		this.items = new Set(iterable);
	}

	has(value: T): boolean {
		return this.items.has(value);
	}

	add(value: T): SvelteSet<T> {
		if (this.items.has(value)) return this;
		return new SvelteSet<T>([...this.items, value]);
	}

	delete(value: T): SvelteSet<T> {
		if (!this.items.has(value)) return this;
		return new SvelteSet<T>(Array.from(this.items).filter((v) => v !== value));
	}

	get size(): number {
		return this.items.size;
	}

	toArray(): T[] {
		return Array.from(this.items);
	}

	[Symbol.iterator](): IterableIterator<T> {
		return this.items[Symbol.iterator]();
	}
}

// Lightweight immutable SvelteDate helper
// Use immutable wrapper to avoid mutating built-in Date instances in Svelte components.
export class SvelteDate {
	private readonly d: Date;

	constructor(value?: string | number | Date | SvelteDate) {
		if (value instanceof SvelteDate) this.d = value.toDate();
		else if (value instanceof Date) this.d = new Date(value.getTime());
		else if (value === undefined) this.d = new Date();
		else this.d = new Date(value as string | number);
	}

	static now(): SvelteDate {
		return new SvelteDate();
	}

	static from(value?: string | number | Date | SvelteDate): SvelteDate {
		return value instanceof SvelteDate ? value : new SvelteDate(value as string | number | Date);
	}

	getTime(): number {
		return this.d.getTime();
	}

	toDate(): Date {
		return new Date(this.d.getTime());
	}

	toISOString(): string {
		return this.d.toISOString();
	}

	toLocaleDateString(locale?: string, opts?: Intl.DateTimeFormatOptions): string {
		return this.d.toLocaleDateString(locale, opts);
	}

	toLocaleString(locale?: string, opts?: Intl.DateTimeFormatOptions): string {
		return this.d.toLocaleString(locale, opts);
	}

	toLocaleTimeString(): string {
		return this.d.toLocaleTimeString();
	}

	getFullYear(): number {
		return this.d.getFullYear();
	}

	getMonth(): number {
		return this.d.getMonth();
	}

	getDate(): number {
		return this.d.getDate();
	}

	// YYYY-MM-DD input-friendly format (local date portion)
	toInput(): string {
		return this.toISOString().slice(0, 10);
	}

	startOfDay(): SvelteDate {
		const d = this.toDate();
		d.setHours(0, 0, 0, 0);
		return new SvelteDate(d);
	}
}
