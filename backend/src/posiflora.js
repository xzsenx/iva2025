import axios from 'axios';

const BASE = process.env.POSIFLORA_BASE_URL;
const USERNAME = process.env.POSIFLORA_USERNAME;
const PASSWORD = process.env.POSIFLORA_PASSWORD;

let accessToken = null;
let refreshToken = null;
let tokenExpiresAt = 0;

const api = axios.create({
  baseURL: BASE,
  headers: { Accept: 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json' },
  timeout: 30000,
});

async function login() {
  const res = await api.post('/v1/sessions', {
    data: { type: 'sessions', attributes: { username: USERNAME, password: PASSWORD } },
  });
  const attrs = res.data.data.attributes;
  accessToken = attrs.accessToken;
  refreshToken = attrs.refreshToken;
  tokenExpiresAt = new Date(attrs.expireAt).getTime() - 60_000;
  return accessToken;
}

async function ensureToken() {
  if (!accessToken || Date.now() >= tokenExpiresAt) {
    await login();
  }
  return accessToken;
}

async function call(method, path, { params, data } = {}) {
  const token = await ensureToken();
  try {
    const res = await api.request({
      method, url: path, params, data,
      headers: { Authorization: `Bearer ${token}` },
      paramsSerializer: { indexes: null },
    });
    return res.data;
  } catch (e) {
    if (e.response?.status === 401) {
      await login();
      const res = await api.request({
        method, url: path, params, data,
        headers: { Authorization: `Bearer ${accessToken}` },
        paramsSerializer: { indexes: null },
      });
      return res.data;
    }
    throw e;
  }
}

async function getAll(path, params = {}, pageSize = 100) {
  const out = [];
  const included = [];
  let pageNumber = 1;
  while (true) {
    const data = await call('GET', path, {
      params: { ...params, 'page[size]': pageSize, 'page[number]': pageNumber },
    });
    out.push(...(data.data || []));
    included.push(...(data.included || []));
    const total = data.meta?.total ?? out.length;
    if (out.length >= total || (data.data || []).length === 0) break;
    pageNumber++;
    if (pageNumber > 50) break;
  }
  return { data: out, included };
}

export const posiflora = {
  login,
  bouquets: (params) => getAll('/v1/bouquets', params),
  specifications: (params) => getAll('/v1/specifications', params),
  specificationWithVariants: (params) => getAll('/v1/specification-with-variants', params),
  specificationVariantItems: (params) => getAll('/v1/specification-variant-items', params),
  inventoryItems: (params) => getAll('/v1/inventory-items', { 'filter[available]': true, include: 'category,measure', ...params }),
  categories: (params) => getAll('/v1/categories', params),
  stores: () => getAll('/v1/stores'),
  createOrder: (payload) => call('POST', '/v1/orders', { data: payload }),
};
