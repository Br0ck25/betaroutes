declare module '@simplewebauthn/types' {
	export type AuthenticatorTransport = 'usb' | 'ble' | 'nfc' | 'internal' | string;
	export type CredentialDeviceType = 'single' | 'multi' | string;
	// Minimal subset used by the project; add more as needed
}
