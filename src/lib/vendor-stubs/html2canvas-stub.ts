// Minimal browser stub for html2canvas used to avoid bundling heavy library in client builds.
// The real library is imported on the server when generating PDFs.
export default async function html2canvas(_: Element, __?: any): Promise<any> {
	// Refer to the parameters so linters don't mark them as unused in the browser stub.
	void _;
	void __;
	return Promise.reject(
		new Error('html2canvas stub called in browser build. Use server-side import instead.')
	);
}
