import assert from 'node:assert/strict';
import { test } from 'node:test';
import { todayEvents } from './today.ts';
import type { Graph } from '../types';

test('today includes anniversaries and recent memorials with the Almanac rules', () => {
 const graph = { people: [
  {id:'a', given:'Anna', living:true, born:'1990-11-08'},
  {id:'b', given:'Ben', living:true},
  {id:'c', given:'Cora', living:false, died:'2000-11-08'},
  {id:'d', given:'Dan', living:false, died:'1900-11-08'},
 ], unions: [
  {id:'u', a:'a', b:'b', kind:'marriage', start:'1988-11-08'},
  {id:'ended', a:'a', b:'b', kind:'marriage', start:'1988-11-08', end:'2000'},
 ] } as Graph;
 assert.deepEqual(todayEvents(graph, new Date(2026,10,8)).map(e=>e.key), ['b:a','m:c','a:u']);
 assert.equal(todayEvents(graph, new Date(2026,10,9)).length, 0);
});
