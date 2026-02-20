export function badRequest(message, details = undefined) {
  const err = new Error(message);
  err.status = 400;
  if (details !== undefined) err.details = details;
  return err;
}

export function asTrimmedString(value) {
  return String(value ?? '').trim();
}

export function requireString(value, field) {
  const s = asTrimmedString(value);
  if (!s) throw badRequest(`${field} is required`);
  return s;
}

export function optionalString(value) {
  const s = asTrimmedString(value);
  return s || null;
}

export function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((x) => asTrimmedString(x)).filter(Boolean);
}

export function unique(values) {
  return [...new Set(values)];
}

export function assertEthereumAddress(address, field = 'address') {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw badRequest(`${field} must be a valid ethereum address`);
  }
  return address;
}
