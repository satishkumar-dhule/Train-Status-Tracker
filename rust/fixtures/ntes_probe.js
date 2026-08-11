const crypto = require('crypto');

const KEY = Buffer.from('8EA4DB2CC1EB3DC5', 'ascii');
const IV = Buffer.from('7DC5EB3BB4DB6EA8', 'ascii');
const SCKEY = '645fbc1e56e23365f2f3c204ae0899f6';

function build(data) {
  const hash = crypto.createHash('md5').update(data + SCKEY).digest('hex').toUpperCase();
  const cipher = crypto.createCipheriv('aes-128-cbc', KEY, IV);
  let encrypted = cipher.update(data, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return hash + '#' + Buffer.from(encrypted, 'ascii').toString('hex').toUpperCase();
}

function decode(enc) {
  const part = enc.split('#').pop();
  const b64 = Buffer.from(part, 'hex').toString('ascii');
  const decipher = crypto.createDecipheriv('aes-128-cbc', KEY, IV);
  let out = decipher.update(b64, 'base64', 'utf8');
  out += decipher.final('utf8');
  return out;
}

const trainNo = process.argv[2] || '12301';
const startDate = process.argv[3] || '10-Aug-2026';
const payload = `service=TrainRunningMob&subService=ShowFullRunJson&trainNo=${trainNo}&startDate=${startDate}`;
const jsonIn = build(payload);

fetch('https://enquiry.indianrail.gov.in/crisns/AppServAnd', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonIn }),
})
  .then(async (r) => {
    const text = await r.text();
    if (!text) throw new Error('empty response body');
    const wrapped = JSON.parse(text);
    const decrypted = decode(wrapped.jsonIn);
    process.stdout.write(decrypted);
  })
  .catch((e) => { console.error('ERR', e.message); process.exit(1); });
