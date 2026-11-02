import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createClaim,createLifecycleTransition} from '../../core/src/index.ts';
import {ClaimLedger} from '../src/index.ts';

const at='2026-01-01T00:00:00Z';
const later='2026-02-01T00:00:00Z';
function claim(){return {...createClaim({id:'claim:owned',subject:'entity:owner',predicate:'memory:status',object:{nested:['original']},validTime:{from:at},recordedAt:at,authority:{level:50,basis:'explicit'},confidence:0.9,lifecycle:'verified'}),object:{nested:['original']},authority:{level:50,basis:'explicit'},validTime:{from:at}};}
function query(){return {subject:'entity:owner',predicate:'memory:status',validAt:later,recordedAt:later};}

test('append owns claim values, authority and temporal fields without freezing the caller',()=>{
 const input=claim(); const ledger=new ClaimLedger();ledger.append(input);
 const before=JSON.stringify(ledger.canonicalRecords());
 input.object.nested[0]='rewritten';input.authority.level=999;input.validTime.from=later;
 assert.equal(JSON.stringify(ledger.canonicalRecords()),before);
 assert.equal(ledger.projectAt(query()).selected?.claim.authority.level,50);
 assert.equal(Object.isFrozen(input),false);
});
test('appended lifecycle cannot be rewritten to undo a retraction',()=>{
 const ledger=new ClaimLedger();ledger.append(claim());
 const transition={...createLifecycleTransition({id:'lifecycle:retract',targetId:'claim:owned',status:'retracted',reason:'withdrawal',recordedAt:'2026-01-15T00:00:00Z',authority:{level:60,basis:'authorized'}}),authority:{level:60,basis:'authorized'}};
 ledger.appendLifecycleTransition(transition);
 const before=JSON.stringify(ledger.canonicalRecords());
 transition.status='verified';transition.authority.level=1000;
 assert.equal(JSON.stringify(ledger.canonicalRecords()),before);
 assert.equal(ledger.projectAt(query()).selected,undefined);
 assert.equal(ledger.lifecycleHistory('claim:owned')[0]!.status,'retracted');
});
test('history and canonical views do not expose a writable nested canonical object',()=>{
 const ledger=new ClaimLedger();ledger.append(claim());
 const exposed=ledger.history()[0]!;
 const value=exposed.object as {readonly nested:readonly string[]};
 assert.equal(Object.isFrozen(exposed),true);
 assert.equal(Object.isFrozen(value.nested),true);
 assert.throws(()=>Object.defineProperty(value.nested,'0',{value:'changed'}),TypeError);
 assert.equal((ledger.history()[0]!.object as {nested:string[]}).nested[0],'original');
});
test('replay from canonical records remains equivalent after caller mutation',()=>{
 const ledger=new ClaimLedger(); const input=claim();ledger.append(input);
 const before=JSON.stringify(ledger.projectAt(query()));input.object.nested.push('new');
 assert.equal(JSON.stringify(ClaimLedger.replay(ledger.canonicalRecords()).projectAt(query())),before);
});
