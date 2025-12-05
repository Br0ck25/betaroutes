export async function authenticateUser(identifier: string, password: string) {
	// If identifier contains "@", treat as email
	const isEmail = identifier.includes('@');

	let user = isEmail
		? await findUserByEmail(identifier)
		: await findUserByUsername(identifier);

	if (!user) return null;
	if (user.password !== password) return null;

	return { id: user.id, username: user.username, email: user.email };
}
