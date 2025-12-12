import { json } from '@sveltejs/kit';

export const GET = async ({ url, platform }) => {
    const q = url.searchParams.get("q") ?? "";
    const kv = platform?.env?.BETA_PLACES_KV;

    if (q.length < 2) return json([]);

    const prefix = q.toLowerCase().trim();
    console.log("[DEBUG] PREFIX SEARCH:", prefix);

    // ---- SEARCH KV ----
    const list = await kv.list({ prefix });
    console.log("[DEBUG] KV LIST:", list);

    const results = [];

    for (const key of list.keys) {
        const value = await kv.get(key.name);
        console.log("[DEBUG] KV MATCH:", key.name, value);
        results.push(JSON.parse(value));
    }

    if (results.length > 0) return json(results);

    // ---- GOOGLE FALLBACK ----
    const googleKey = platform.env.PUBLIC_GOOGLE_MAPS_API_KEY;
    const googleURL = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(q)}&key=${googleKey}`;
    
    const res = await fetch(googleURL);
    const data = await res.json();

    console.log("[DEBUG] GOOGLE RESULTS:", data.predictions);

    for (const p of data.predictions) {
        const key = p.description.toLowerCase();
        console.log("[DEBUG] WRITING KV KEY:", key);
        await kv.put(key, JSON.stringify({
            formatted_address: p.description,
            name: p.structured_formatting?.main_text,
        }));
    }

    return json(data.predictions.map(p => ({
        formatted_address: p.description,
        name: p.structured_formatting?.main_text,
    })));
};
