import { expect, test } from 'bun:test'
import { parseMetrics, validateCapture } from '../src/analytics'
const postId = '123456789'
const response = (video:unknown, rest_id=postId) => ({data:{tweet_result_by_rest_id:{result:{rest_id,video}}}})
test('104 completions yield 0.104 USDC and unique views stay separate',()=>{
  expect(parseMetrics(response([{metric_type:'UniqueVideoViews',metric_value:735},{metric_type:'VideoCompletions',metric_value:104}]),postId)).toEqual({uniqueViews:735,completions:104,amountUsdc6:104000n})
})
test('rejects mismatched post, missing or duplicate metrics',()=>{
  expect(parseMetrics(response([{metric_type:'UniqueVideoViews',metric_value:735},{metric_type:'VideoCompletions',metric_value:104}]),'999')).toBeUndefined()
  expect(parseMetrics(response([{metric_type:'VideoCompletions',metric_value:104}]),postId)).toBeUndefined()
  expect(parseMetrics(response([{metric_type:'UniqueVideoViews',metric_value:1},{metric_type:'UniqueVideoViews',metric_value:2},{metric_type:'VideoCompletions',metric_value:1}]),postId)).toBeUndefined()
})
test('capture accepts only matching X operation and auth session',()=>{
  const url = `https://x.com/i/api/graphql/abc/TweetActivityQuery?variables=${encodeURIComponent(JSON.stringify({restId:postId}))}`
  const headers = {cookie:'auth_token=abc; ct0=abcdefgh', 'x-csrf-token':'abcdefgh', authorization:'Bearer abcdefghijklmnop'}
  expect(validateCapture({url,headers},postId)?.url).toBe(url)
  expect(validateCapture({url:url.replace('x.com','evil.com'),headers},postId)).toBeUndefined()
  expect(validateCapture({url,headers},'999')).toBeUndefined()
  expect(validateCapture({url,headers:{...headers,'x-csrf-token':'different'}},postId)).toBeUndefined()
})
