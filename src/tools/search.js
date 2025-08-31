import google from 'googlethis';

export async function webSearch(query, options = {}) {
  const { page = 0, safe = true, additional_params = { hl: 'en' } } = options;
  const res = await google.search(query, { page, safe, additional_params });
  const results = (res?.results || []).map((r) => ({ title: r.title, url: r.url, description: r.description }));
  return { results, knowledge_panel: res?.knowledge_panel ?? null, did_you_mean: res?.did_you_mean ?? null };
}

