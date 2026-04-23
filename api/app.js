'use strict';

const { URL } = require('url');
const checker = require('../libs/javascript');

const JSON_CONTENT_TYPE = { 'Content-Type': 'application/json; charset=utf-8' };
const MAX_REQUEST_BODY_SIZE = 1_000_000;

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, JSON_CONTENT_TYPE);
  res.end(JSON.stringify(payload));
}

function normalizeDigits(value) {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '');
  return digits || null;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let completed = false;

    function done(err, payload) {
      if (completed) return;
      completed = true;
      if (err) {
        reject(err);
        return;
      }
      resolve(payload);
    }

    req.on('data', chunk => {
      if (completed) return;
      body += chunk;
      if (body.length > MAX_REQUEST_BODY_SIZE) {
        done(new Error('Request body too large'));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (completed) return;
      if (!body) {
        done(null, {});
        return;
      }

      try {
        done(null, JSON.parse(body));
      } catch (error) {
        done(new Error('Invalid JSON body'));
      }
    });

    req.on('error', err => done(err));
  });
}

function parseBoolean(value, defaultValue = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lowered = value.toLowerCase();
    return lowered === 'true' || lowered === '1';
  }
  return defaultValue;
}

function readCardNumber(body) {
  return normalizeDigits(body && body.cardNumber);
}

function createHandler() {
  return async function handler(req, res) {
    const method = req.method || 'GET';
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    const pathname = requestUrl.pathname;

    if (method === 'GET' && pathname === '/health') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (method === 'GET' && pathname === '/brands') {
      sendJson(res, 200, { brands: checker.listBrands() });
      return;
    }

    if (method === 'GET' && pathname.startsWith('/brands/')) {
      const scheme = decodeURIComponent(pathname.slice('/brands/'.length));
      const detailed = parseBoolean(requestUrl.searchParams.get('detailed'), false);
      const brand = detailed ? checker.getBrandInfoDetailed(scheme) : checker.getBrandInfo(scheme);

      if (!brand) {
        sendJson(res, 404, { error: 'Brand not found' });
        return;
      }

      sendJson(res, 200, brand);
      return;
    }

    if (method === 'POST' && pathname === '/support') {
      try {
        const body = await readJsonBody(req);
        const cardNumber = readCardNumber(body);

        if (!cardNumber) {
          sendJson(res, 400, { error: 'cardNumber is required' });
          return;
        }

        sendJson(res, 200, { supported: checker.isSupported(cardNumber) });
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
      return;
    }

    if (method === 'POST' && pathname === '/luhn') {
      try {
        const body = await readJsonBody(req);
        const cardNumber = readCardNumber(body);

        if (!cardNumber) {
          sendJson(res, 400, { error: 'cardNumber is required' });
          return;
        }

        sendJson(res, 200, { valid: checker.luhn(cardNumber) });
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
      return;
    }

    if (method === 'POST' && pathname === '/check') {
      try {
        const body = await readJsonBody(req);
        const cardNumber = readCardNumber(body);

        if (!cardNumber) {
          sendJson(res, 400, { error: 'cardNumber is required' });
          return;
        }

        const detailed = parseBoolean(body.detailed, false);
        const supported = checker.isSupported(cardNumber);
        const luhnValid = checker.luhn(cardNumber);

        if (!supported) {
          sendJson(res, 200, {
            supported: false,
            luhnValid,
            brand: null,
            cvvValid: null
          });
          return;
        }

        const brand = checker.findBrand(cardNumber, detailed);
        const response = {
          supported: true,
          luhnValid,
          brand,
          cvvValid: null
        };

        const cvv = normalizeDigits(body.cvv);
        if (cvv) {
          response.cvvValid = checker.validateCvv(cvv, brand);
        }

        sendJson(res, 200, response);
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  };
}

module.exports = {
  createHandler
};
