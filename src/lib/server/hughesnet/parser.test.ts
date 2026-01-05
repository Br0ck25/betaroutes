import { describe, it, expect } from 'vitest';
import { parseOrderPage } from './parser';

describe('HughesNet parser wifi detection', () => {
	it('detects wifi extender from shorthand SearchUtilData cell', () => {
		const html = `
		<html>
		  <body>
		    <table>
		      <tr>
		        <td class="SearchUtilData">MESH WIFI INST L</td>
		      </tr>
		    </table>
		  </body>
		</html>`;
		const parsed = parseOrderPage(html, '123');
		expect(parsed.hasWifiExtender).toBe(true);
	});
});
