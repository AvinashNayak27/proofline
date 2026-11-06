import { expect, test } from 'bun:test'
import { parseMetrics, rewardUsdc6, validateCapture } from '../src/analytics'
const postId = '123456789'
const response = (video:unknown, rest_id=postId) => ({data:{tweet_result_by_rest_id:{result:{rest_id,video}}}})
test('reward = min(5 USDC, views/1000 * (1 + 0.5 * retention^2)) in 6-decimal units',()=>{
  expect(rewardUsdc6(1000,0)).toBe(1_000_000n)       // no completions: retention 0 -> 1.0 USDC
  expect(rewardUsdc6(1000,1000)).toBe(1_500_000n)    // full retention -> 1.5 USDC
  expect(rewardUsdc6(1000,500)).toBe(1_125_000n)     // retention 0.5 -> 1 + 0.5 * 0.25
  expect(rewardUsdc6(735,104)).toBe(735_000n + (500n*104n*104n)/735n)
  expect(rewardUsdc6(2000,9999)).toBe(3_000_000n)    // retention capped at 1
  expect(rewardUsdc6(3333,3333)).toBe(4_999_500n)    // just under the cap
  expect(rewardUsdc6(3334,3334)).toBe(5_000_000n)    // 5.001 USDC is capped at 5
  expect(rewardUsdc6(100_000_000,100_000_000)).toBe(5_000_000n)
})
test('no unique views means no reward and no division by zero',()=>{
  expect(rewardUsdc6(0,0)).toBe(0n)
  expect(rewardUsdc6(0,50)).toBe(0n)
})
test('metrics parse and price the reward from the response',()=>{
  expect(parseMetrics(response([{metric_type:'UniqueVideoViews',metric_value:735},{metric_type:'VideoCompletions',metric_value:104}]),postId)).toEqual({uniqueViews:735,completions:104,amountUsdc6:735_000n+(500n*104n*104n)/735n})
})
test('missing metrics or metric_value count as 0',()=>{
  const views=[{metric_type:'UniqueVideoViews',metric_value:2000}]
  expect(parseMetrics(response(views),postId)).toEqual({uniqueViews:2000,completions:0,amountUsdc6:2_000_000n})
  expect(parseMetrics(response([...views,{metric_type:'VideoCompletions'}]),postId)?.completions).toBe(0)
  expect(parseMetrics(response([...views,{metric_type:'VideoCompletions',metric_value:null}]),postId)?.completions).toBe(0)
  expect(parseMetrics(response([{metric_type:'UniqueVideoViews'},{metric_type:'VideoCompletions'}]),postId)).toEqual({uniqueViews:0,completions:0,amountUsdc6:0n})
  expect(parseMetrics(response(undefined),postId)).toEqual({uniqueViews:0,completions:0,amountUsdc6:0n})
})
test('still rejects mismatched post, duplicate metrics and malformed values',()=>{
  const ok=[{metric_type:'UniqueVideoViews',metric_value:735},{metric_type:'VideoCompletions',metric_value:104}]
  expect(parseMetrics(response(ok),'999')).toBeUndefined()
  expect(parseMetrics({data:{}},postId)).toBeUndefined()
  expect(parseMetrics(response('nope'),postId)).toBeUndefined()
  expect(parseMetrics(response([{metric_type:'UniqueVideoViews',metric_value:1},{metric_type:'UniqueVideoViews',metric_value:2},{metric_type:'VideoCompletions',metric_value:1}]),postId)).toBeUndefined()
  expect(parseMetrics(response([{metric_type:'UniqueVideoViews',metric_value:-1}]),postId)).toBeUndefined()
  expect(parseMetrics(response([{metric_type:'UniqueVideoViews',metric_value:1.5}]),postId)).toBeUndefined()
  expect(parseMetrics(response([{metric_type:'UniqueVideoViews',metric_value:'12'}]),postId)).toBeUndefined()
})
test('capture accepts only matching X operation and auth session',()=>{
  const url = `https://x.com/i/api/graphql/abc/TweetActivityQuery?variables=${encodeURIComponent(JSON.stringify({restId:postId}))}`
  const headers = {cookie:'auth_token=abc; ct0=abcdefgh', 'x-csrf-token':'abcdefgh', authorization:'Bearer abcdefghijklmnop'}
  expect(validateCapture({url,headers},postId)?.url).toBe(url)
  expect(validateCapture({url:url.replace('x.com','evil.com'),headers},postId)).toBeUndefined()
  expect(validateCapture({url,headers},'999')).toBeUndefined()
  expect(validateCapture({url,headers:{...headers,'x-csrf-token':'different'}},postId)).toBeUndefined()
})
