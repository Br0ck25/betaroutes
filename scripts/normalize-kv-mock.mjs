import fs from 'fs';
import path from 'path';

const filePath = path.resolve(process.cwd(), '.kv-mock.json');
const backupPath = `${filePath}.bak`;

if (!fs.existsSync(filePath)) {
	console.error('.kv-mock.json not found');
	process.exit(1);
}

const raw = fs.readFileSync(filePath, 'utf8');
fs.writeFileSync(backupPath, raw, 'utf8');

let newText = raw;
let countPhotonPlaceId = 0;
let countPhotonSource = 0;

// Replace raw photon tokens with osm- (covers both bare and embedded cases)
newText = newText.replace(/photon:/g, (m) => {
	countPhotonPlaceId += 1;
	return 'osm-';
});

// Replace "source":"photon" -> "source":"kv"
newText = newText.replace(/"source":"photon"/g, () => {
	countPhotonSource += 1;
	return '"source":"kv"';
});

if (newText === raw) {
	console.log('No changes required (no photon occurrences found).');
	process.exit(0);
}

fs.writeFileSync(filePath, newText, 'utf8');
console.log(
	`Normalized .kv-mock.json: place_id edits=${countPhotonPlaceId}, source edits=${countPhotonSource}`
);
console.log(`Backup saved to ${backupPath}`);
