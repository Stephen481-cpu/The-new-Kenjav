/**
 * M-Pesa STK Push scaffold — Safaricom Daraja API.
 *
 * STATUS: written to Daraja's documented request/response shape, but NOT tested
 * against Safaricom's real servers (that needs an approved app + real credentials,
 * which only KENJAV can obtain, and a network connection this sandbox doesn't have).
 * Treat this as a well-structured starting point, not a finished, verified feature.
 *
 * NOT wired into server.js yet. To use it: register at
 * https://developer.safaricom.co.ke, get sandbox credentials first (they're free and
 * instant), test end-to-end in sandbox, THEN apply for production (go-live) credentials
 * before taking real customer payments.
 *
 * Docs to check against once you have credentials (things do shift over time):
 * https://developer.safaricom.co.ke/APIs/MpesaExpressSimulate
 */

const https = require('https');

const MPESA_ENV = process.env.MPESA_ENV || 'sandbox'; // 'sandbox' or 'production'
const BASE_HOST = MPESA_ENV === 'production' ? 'api.safaricom.co.ke' : 'sandbox.safaricom.co.ke';

function httpsRequest(hostname, path, method, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method, headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getAccessToken() {
  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;
  if (!key || !secret) throw new Error('MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET not set in .env');

  const auth = Buffer.from(`${key}:${secret}`).toString('base64');
  const res = await httpsRequest(
    BASE_HOST,
    '/oauth/v1/generate?grant_type=client_credentials',
    'GET',
    { Authorization: `Basic ${auth}` }
  );
  if (res.status !== 200 || !res.body.access_token) {
    throw new Error('Failed to get M-Pesa access token: ' + JSON.stringify(res.body));
  }
  return res.body.access_token;
}

function timestampNow() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * Triggers an STK push prompt on the customer's phone.
 * @param {string} phone - format 2547XXXXXXXX (no +, no leading 0)
 * @param {number} amount - whole KSh, no decimals
 * @param {string} accountRef - short reference shown to the customer, e.g. order id
 */
async function stkPush(phone, amount, accountRef) {
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  const callbackUrl = process.env.MPESA_CALLBACK_URL;
  if (!shortcode || !passkey || !callbackUrl) {
    throw new Error('MPESA_SHORTCODE / MPESA_PASSKEY / MPESA_CALLBACK_URL not set in .env');
  }

  const accessToken = await getAccessToken();
  const timestamp = timestampNow();
  const password = Buffer.from(shortcode + passkey + timestamp).toString('base64');

  const payload = JSON.stringify({
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.round(amount),
    PartyA: phone,
    PartyB: shortcode,
    PhoneNumber: phone,
    CallBackURL: callbackUrl,
    AccountReference: accountRef.slice(0, 12),
    TransactionDesc: 'KENJAV order'
  });

  const res = await httpsRequest(
    BASE_HOST,
    '/mpesa/stkpush/v1/processrequest',
    'POST',
    {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    },
    payload
  );
  return res.body; // contains CheckoutRequestID etc. on success — save it against the order
}

module.exports = { stkPush, getAccessToken };

/**
 * To actually use this from server.js, once you have real credentials:
 *
 *   const { stkPush } = require('./mpesa-stub');
 *   // inside the POST /api/orders handler, after saving the order:
 *   if (process.env.MPESA_SHORTCODE) {
 *     stkPush(body.phone, order.total, order.id)
 *       .then(r => console.log('STK push sent:', r))
 *       .catch(e => console.error('STK push failed:', e.message));
 *   }
 *
 * You'll also need a publicly reachable route for MPESA_CALLBACK_URL (e.g. POST
 * /api/mpesa/callback) where Safaricom sends the payment result — that route
 * doesn't exist yet either, since its shape depends on testing against the real API.
 */
