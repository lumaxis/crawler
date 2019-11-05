// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const assert = require('chai').assert
const expect = require('chai').expect
const Request = require('../../../ghcrawler/lib/request.js')
const QueueSet = require('../../../ghcrawler/providers/queuing/queueSet.js')
const sinon = require('sinon')

describe('QueueSet construction', () => {
  it('should throw on duplicate queue names', () => {
    expect(() => new QueueSet([createBaseQueue('1'), createBaseQueue('1')])).to.throw(Error)
  })
})

describe('QueueSet weighting', () => {
  it('should create a simple startMap', () => {
    const set = new QueueSet([createBaseQueue('1'), createBaseQueue('2')], createOptions({ '1': 3, '2': 2 }))
    expect(set.startMap.length).to.be.equal(5)
    expect(set.startMap[0]).to.be.equal(0)
    expect(set.startMap[1]).to.be.equal(0)
    expect(set.startMap[2]).to.be.equal(0)
    expect(set.startMap[3]).to.be.equal(1)
    expect(set.startMap[4]).to.be.equal(1)
  })

  it('should create a default startMap if no weights given', () => {
    const set = new QueueSet([createBaseQueue('1'), createBaseQueue('2')], { _config: { on: () => { } } })
    expect(set.startMap.length).to.be.equal(2)
    expect(set.startMap[0]).to.be.equal(0)
    expect(set.startMap[1]).to.be.equal(1)
  })

  it('should throw if no weights are given', () => {
    expect(() => new QueueSet([createBaseQueue('1'), createBaseQueue('2')], {})).to.throw(Error)
  })

  it('should pop other queue if nothing available', async () => {
    const priority = createBaseQueue('priority', {
      pop: async () => new Request('priority', 'http://test')
    })
    const normal = createBaseQueue('normal', {
      pop: async () => null
    })
    const queues = createBaseQueues([priority, normal], null, [1, 1])
    queues.popCount = 1

    const first = await queues.pop()
    const second = await queues.pop()
    expect(first.type).to.be.equal('priority')
    expect(first._originQueue === priority).to.be.true
    expect(second.type).to.be.equal('priority')
    expect(second._originQueue === priority).to.be.true
  })
})

describe('QueueSet pushing', () => {
  it('should accept a simple request into a named queue', async () => {
    const priority = createBaseQueue('priority', {
      push: async () => null

    })
    const normal = createBaseQueue('normal')
    const queues = createBaseQueues([priority, normal])
    sinon.spy(priority, 'push')
    const request = new Request('test', 'http://test')

    await queues.push(request, 'priority')
    expect(priority.push.callCount).to.be.equal(1)
    expect(priority.push.getCall(0).args[0].type).to.be.equal('test')
  })

  it('should throw when pushing into an unknown queue', async () => {
    const priority = createBaseQueue('priority', {
      push: async () => null
    })
    const normal = createBaseQueue('normal', {
      push: async () => null
    })
    const queues = createBaseQueues([priority, normal])
    const request = new Request('test', 'http://test')

    expect(() => queues.push(request, 'foo')).to.throw(Error)
  })

  it('should repush into the same queue', async () => {
    const priority = createBaseQueue('priority', {
      pop: async () => new Request('test', 'http://test'),
      push: () => null
    })
    const queues = createBaseQueues([priority])
    sinon.spy(priority, 'push')

    const request = await queues.pop()
    await queues.repush(request, request)
    expect(request._originQueue === priority).to.be.true
    expect(priority.push.callCount).to.be.equal(1)
    expect(priority.push.getCall(0).args[0].type).to.be.equal('test')
  })
})

describe('QueueSet originQueue management', () => {
  it('should call done and mark acked on done', async () => {
    const priority = createBaseQueue('priority', {
      pop: async () => new Request('test', 'http://test'),
      done: async () => null
    })
    const queues = createBaseQueues([priority])
    sinon.spy(priority, 'done')

    const request = await queues.pop()
    await queues.done(request)
    expect(request.acked).to.be.true
    expect(priority.done.callCount).to.be.equal(1)
    expect(priority.done.getCall(0).args[0].type).to.be.equal('test')
  })

  it('should call done and mark acked on abandon', async () => {
    const priority = createBaseQueue('priority', {
      pop: async () => new Request('test', 'http://test'),
      abandon: async () => null
    })
    const queues = createBaseQueues([priority])
    sinon.spy(priority, 'abandon')

    const request = await queues.pop()
    await queues.abandon(request)
    expect(request.acked).to.be.true
    expect(priority.abandon.callCount).to.be.equal(1)
    expect(priority.abandon.getCall(0).args[0].type).to.be.equal('test')
  })

  it('should not abandon twice', async () => {
    const priority = createBaseQueue('priority', {
      pop: async () => new Request('test', 'http://test'),
      abandon: async () => null
    })
    const queues = createBaseQueues([priority])
    sinon.spy(priority, 'abandon')

    const request = await queues.pop()
    await queues.abandon(request)
    await queues.abandon(request)
    expect(request.acked).to.be.true
    expect(priority.abandon.callCount).to.be.equal(1)
    expect(priority.abandon.getCall(0).args[0].type).to.be.equal('test')
  })

  it('should not done after abandon ', async () => {
    const priority = createBaseQueue('priority', {
      pop: async () => new Request('test', 'http://test'),
      abandon: async () => null,
      done: async () => null
    })
    const queues = createBaseQueues([priority])
    sinon.spy(priority, 'abandon')
    sinon.spy(priority, 'done')

    const request = await queues.pop()
    await queues.abandon(request)
    await queues.done(request)
    expect(request.acked).to.be.true
    expect(priority.done.callCount).to.be.equal(0)
    expect(priority.abandon.callCount).to.be.equal(1)
    expect(priority.abandon.getCall(0).args[0].type).to.be.equal('test')
  })
})

describe('QueueSet subscription management', () => {
  it('should subscribe all', () => {
    const priority = createBaseQueue('priority', { subscribe: () => { } })
    const normal = createBaseQueue('normal', { subscribe: () => { } })
    const queues = createBaseQueues([priority, normal])
    sinon.spy(priority, 'subscribe')
    sinon.spy(normal, 'subscribe')

    return queues.subscribe().then(() => {
      expect(priority.subscribe.callCount).to.be.equal(1)
      expect(normal.subscribe.callCount).to.be.equal(1)
    })
  })

  it('should unsubscribe all', () => {
    const priority = createBaseQueue('priority', { unsubscribe: () => { } })
    const normal = createBaseQueue('normal', { unsubscribe: () => { } })
    const queues = createBaseQueues([priority, normal])
    sinon.spy(priority, 'unsubscribe')
    sinon.spy(normal, 'unsubscribe')

    return queues.unsubscribe().then(() => {
      expect(priority.unsubscribe.callCount).to.be.equal(1)
      expect(normal.unsubscribe.callCount).to.be.equal(1)
    })
  })
})

function createOptions(weights) {
  return {
    weights: weights,
    _config: { on: () => { } }
  }
}

function createBaseQueues(queues, weights = null) {
  return new QueueSet(queues, createOptions(weights))
}

function createBaseQueue(
  name,
  { pop = null, push = null, done = null, abandon = null, subscribe = null, unsubscribe = null } = {}
) {
  const result = { name: name }
  result.getName = () => {
    return name
  }
  result.pop = pop || (() => assert.fail('should not pop'))
  result.push = push || (() => assert.fail('should not push'))
  result.done = done || (() => assert.fail('should not done'))
  result.abandon = abandon || (() => assert.fail('should not abandon'))
  result.subscribe = subscribe || (() => assert.fail('should not subscribe'))
  result.unsubscribe = unsubscribe || (() => assert.fail('should not unsubscribe'))
  return result
}