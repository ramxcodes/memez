import { describe, expect, it } from 'vitest'
import { meanVector, mergeTextLines, samplePoints, typicalFrame } from './clip'

describe('samplePoints', () => {
  it('takes 6 frames from the middle 90% of a long video', () => {
    const points = samplePoints({ kind: 'video', seconds: 60 })
    expect(points).toHaveLength(6)
    expect(points[0]).toBeCloseTo(7.5)
    expect(points[5]).toBeCloseTo(52.5)
    expect(points.every((t) => t > 3 && t < 57)).toBe(true)
  })

  it('takes fewer frames from a short video, at least one', () => {
    expect(samplePoints({ kind: 'video', seconds: 1.2 })).toHaveLength(2)
    expect(samplePoints({ kind: 'video', seconds: 0.2 })).toEqual([0.1])
  })

  it('gives frame indexes for a GIF, without repeats', () => {
    expect(samplePoints({ kind: 'gif', frames: 100 })).toEqual([12, 27, 42, 57, 72, 87])
    expect(samplePoints({ kind: 'gif', frames: 3 })).toEqual([0, 1, 2])
    expect(samplePoints({ kind: 'gif', frames: 1 })).toEqual([0])
  })
})

describe('meanVector', () => {
  it('averages the frames and scales the result to length 1', () => {
    const [x, y] = meanVector([
      [1, 0],
      [0, 1]
    ])
    expect(x).toBeCloseTo(Math.SQRT1_2)
    expect(y).toBeCloseTo(Math.SQRT1_2)
    expect(meanVector([[0.6, 0.8]])).toEqual([0.6, 0.8])
  })
})

describe('typicalFrame', () => {
  it('picks the frame closest to the average, not the first one', () => {
    const frames = [
      [1, 0, 0],
      [0.6, 0.8, 0],
      [0, 1, 0]
    ]
    expect(typicalFrame(frames, meanVector(frames))).toBe(1)
  })
})

describe('mergeTextLines', () => {
  it('keeps each line once, in the order it first shows', () => {
    const texts = ['WHEN THE CODE\nWORKS', 'when the code', '', 'BUT YOU  DONT KNOW WHY ', 'works']
    expect(mergeTextLines(texts)).toBe('WHEN THE CODE\nWORKS\nBUT YOU DONT KNOW WHY')
  })

  it('is empty when no frame has text', () => {
    expect(mergeTextLines(['', ' \n '])).toBe('')
  })
})
