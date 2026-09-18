import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Exercise the real Worker functions without credentials or network calls.
const source = await fs.readFile(new URL('./cloudflare-worker.js', import.meta.url), 'utf8');
const { buildQuote } = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { buildQuote };').toString('base64'));
const prices={profile_single_2_0:2100,swing_3_4:17000,wicket_adjacent:13000,delivery_0_60:6000};
for(const pair of [['2 распашных ворот','2 калитки'],['двое распашных ворот','две калитки']]) {
  const q=buildQuote(['50 м профлист',...pair].join('\n'),prices);
  assert.equal(q.total,171000);
  assert.deepEqual(q.lines.map(x=>x.quantity),[50,2,2,1]);
  assert.equal(q.lines[1].price,17000);
}
const explicit=buildQuote('50 м профлист\n2 распашных ворот по 20к\n2 калитки',prices);
assert.equal(explicit.lines[1].price,20000);
assert.equal(explicit.total,177000);
const ordinary=buildQuote('50 м профлист\nраспашные ворота\nкалитка',prices);
assert.equal(ordinary.total,141000);
const chainlink=buildQuote('70х2 рабица по 1300\nРаспашные ворота 16к\nДоставка 7к',prices);
assert.equal(chainlink.total,114000);
assert.deepEqual(chainlink.lines.map(x=>[x.title,x.quantity,x.price,x.amount]),[
  [chainlink.lines[0].title,70,1300,91000],
  [chainlink.lines[1].title,1,16000,16000],
  [chainlink.lines[2].title,1,7000,7000],
]);
console.log('PASS: Worker counts, price boundaries, explicit unit price, ordinary quote');
