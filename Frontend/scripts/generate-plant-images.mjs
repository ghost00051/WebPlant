import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const plantsSource = resolve(root, 'src/data/plants.js')
const outputDir = resolve(root, 'public/plants')

const WIDTH = 800
const HEIGHT = 600
const CREAM = '#faf8f5'
const SAGE = '#7c9082'
const TEAL = '#319197'
const INK = '#2f3a36'
const CENTER = 400
const BASE_Y = 436

function num(value) {
  const rounded = value > -1 && value < 1 ? Math.round(value * 1000) / 1000 : Math.round(value)
  return String(rounded)
}

function el(tag, attrs) {
  const parts = []
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue
    parts.push(`${key}="${typeof value === 'number' ? num(value) : value}"`)
  }
  return `<${tag} ${parts.join(' ')}/>`
}

function g(children, attrs = {}) {
  const parts = []
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue
    parts.push(`${key}="${typeof value === 'number' ? num(value) : value}"`)
  }
  const attributes = parts.length ? ` ${parts.join(' ')}` : ''
  return `<g${attributes}>${children.join('')}</g>`
}

function tf(x, y, rotate = 0) {
  return `translate(${num(x)} ${num(y)}) rotate(${num(rotate)})`
}

function faded(value) {
  return value === 1 ? undefined : value
}

function rotateXY(x, y, degrees) {
  const radians = degrees * Math.PI / 180
  return {
    x: x * Math.cos(radians) - y * Math.sin(radians),
    y: x * Math.sin(radians) + y * Math.cos(radians)
  }
}

function absoluteBlade(centerX, centerY, w, h, degrees) {
  const points = [
    [0, 0],
    [w / 2, -h * 0.34],
    [w / 2, -h * 0.76],
    [0, -h],
    [-w / 2, -h * 0.76],
    [-w / 2, -h * 0.34],
    [0, 0]
  ]
  const mapped = points.map(([x, y]) => {
    const rotated = rotateXY(x, y, degrees)
    return `${num(centerX + rotated.x)} ${num(centerY + rotated.y)}`
  })
  return `M${mapped[0]} C${mapped[1]} ${mapped[2]} ${mapped[3]} C${mapped[4]} ${mapped[5]} ${mapped[6]} Z`
}

function stroke(d, width, color = INK, extra = {}) {
  return el('path', {
    d,
    fill: 'none',
    stroke: color,
    'stroke-width': width,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    ...extra
  })
}

function cubicPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t
  return {
    x: mt ** 3 * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t ** 3 * p3.x,
    y: mt ** 3 * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t ** 3 * p3.y
  }
}

function bladePath(w, h) {
  return `M0 0 C${num(w / 2)} ${num(-h * 0.34)} ${num(w / 2)} ${num(-h * 0.76)} 0 ${num(-h)} C${num(-w / 2)} ${num(-h * 0.76)} ${num(-w / 2)} ${num(-h * 0.34)} 0 0 Z`
}

function swordPath(w, h) {
  return `M0 0 C${num(w * 0.5)} ${num(-h * 0.26)} ${num(w * 0.36)} ${num(-h * 0.72)} 0 ${num(-h)} C${num(-w * 0.36)} ${num(-h * 0.72)} ${num(-w * 0.5)} ${num(-h * 0.26)} 0 0 Z`
}

function asymPath(w, h) {
  return `M0 0 C${num(w * 0.66)} ${num(-h * 0.26)} ${num(w * 0.5)} ${num(-h * 0.74)} 0 ${num(-h)} C${num(-w * 0.4)} ${num(-h * 0.68)} ${num(-w * 0.34)} ${num(-h * 0.28)} 0 0 Z`
}

function asymEdgePoint(t, w, h, side) {
  const mt = 1 - t
  const control1 = side > 0 ? w * 0.66 : w * 0.4
  const control2 = side > 0 ? w * 0.5 : w * 0.34
  const reach1 = side > 0 ? h * 0.26 : h * 0.28
  const reach2 = side > 0 ? h * 0.74 : h * 0.68
  return {
    x: side * (3 * mt * mt * t * control1 + 3 * mt * t * t * control2),
    y: -(3 * mt * mt * t * reach1 + 3 * mt * t * t * reach2 + t ** 3 * h)
  }
}

function ribbonPath(bend, h, w) {
  return `M0 0 C${num(bend * 0.55)} ${num(-h * 0.33)} ${num(bend * 0.95)} ${num(-h * 0.7)} ${num(bend)} ${num(-h)} C${num(bend - w)} ${num(-h * 0.68)} ${num(bend * 0.5 - w)} ${num(-h * 0.32)} 0 0 Z`
}

function scallopPath(w, h, steps = 4) {
  const half = w / 2
  const right = []
  for (let index = 0; index < steps; index += 1) {
    const f0 = index / steps
    const f1 = (index + 1) / steps
    const x0 = half * Math.sin(Math.PI * f0)
    const x1 = half * Math.sin(Math.PI * f1)
    const y0 = -h * f0
    const y1 = -h * f1
    right.push(`Q${num((x0 + x1) / 2 + half * 0.42)} ${num((y0 + y1) / 2)} ${num(x1)} ${num(y1)}`)
  }
  const left = []
  for (let index = steps - 1; index >= 0; index -= 1) {
    const f0 = (index + 1) / steps
    const f1 = index / steps
    const x0 = -half * Math.sin(Math.PI * f0)
    const x1 = -half * Math.sin(Math.PI * f1)
    const y0 = -h * f0
    const y1 = -h * f1
    left.push(`Q${num((x0 + x1) / 2 - half * 0.42)} ${num((y0 + y1) / 2)} ${num(x1)} ${num(y1)}`)
  }
  return `M0 0 ${right.join(' ')} ${left.join(' ')} Z`
}

function spathePath(w, h) {
  return `M0 0 C${num(w * 0.52)} ${num(-h * 0.22)} ${num(w * 0.44)} ${num(-h * 0.72)} 0 ${num(-h)} C${num(-w * 0.44)} ${num(-h * 0.72)} ${num(-w * 0.52)} ${num(-h * 0.22)} 0 0 Z`
}

function blade({ x, y, w, h, rotate = 0, path = bladePath, fill = SAGE, fillOpacity = 1, strokeWidth = 5, veins = 0, veinColor = INK, veinOpacity = 0.3 }) {
  const children = [
    el('path', {
      d: path(w, h),
      fill,
      'fill-opacity': faded(fillOpacity),
      stroke: INK,
      'stroke-width': strokeWidth,
      'stroke-linejoin': 'round'
    })
  ]
  if (veins > 0) {
    const veinLines = [stroke(`M0 -10 L0 ${num(-h + 16)}`, 4, veinColor, { 'stroke-opacity': veinOpacity })]
    for (let index = 1; index <= veins; index += 1) {
      const f = index / (veins + 1)
      const y = -h * f
      const spread = w * 0.34 * (1 - f)
      for (const side of [-1, 1]) {
        veinLines.push(stroke(
          `M0 ${num(y + h * 0.08)} Q${num(side * spread * 0.6)} ${num(y - h * 0.02)} ${num(side * spread)} ${num(y - h * 0.14)}`,
          3,
          veinColor,
          { 'stroke-opacity': veinOpacity }
        ))
      }
    }
    children.push(...veinLines)
  }
  return g(children, { transform: tf(x, y, rotate) })
}

function stemmedStem(fromX, fromY, toX, toY, width, bendX = 0, bendY = 0) {
  const controlX = num((fromX + toX) / 2 + bendX)
  const controlY = num((fromY + toY) / 2 + bendY)
  const d = `M${num(fromX)} ${num(fromY)} Q${controlX} ${controlY} ${num(toX)} ${num(toY)}`
  return [stroke(d, width + 8, INK), stroke(d, width, SAGE)]
}

function shadow() {
  return el('ellipse', { cx: CENTER, cy: 552, rx: 152, ry: 18, fill: INK, 'fill-opacity': 0.08 })
}

function pot() {
  return [
    el('path', { d: 'M290 430 L510 430 L476 542 Q400 558 324 542 Z', fill: TEAL, stroke: INK, 'stroke-width': 7, 'stroke-linejoin': 'round' }),
    el('rect', { x: 282, y: 406, width: 236, height: 36, rx: 18, fill: TEAL, stroke: INK, 'stroke-width': 7 }),
    el('ellipse', { cx: CENTER, cy: 424, rx: 100, ry: 13, fill: INK, 'fill-opacity': 0.3 })
  ].join('')
}

function frame(parts) {
  const body = [
    el('rect', { width: WIDTH, height: HEIGHT, rx: 36, fill: CREAM }),
    el('circle', { cx: CENTER, cy: 296, r: 206, fill: SAGE, 'fill-opacity': 0.16 }),
    shadow(),
    ...parts,
    pot()
  ].join('\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">\n${body}\n</svg>\n`
}

function monsteraLeaf(x, y, w, h, rotate) {
  const slits = []
  for (const t of [0.32, 0.52, 0.72]) {
    const mt = 1 - t
    const edgeX = 3 * mt * mt * t * (w / 2) + 3 * mt * t * t * (w / 2)
    const edgeY = 3 * mt * mt * t * (-0.34 * h) + 3 * mt * t * t * (-0.76 * h) + t ** 3 * -h
    for (const side of [-1, 1]) {
      slits.push(el('path', { d: `M${num(side * (edgeX + 6))} ${num(edgeY + 10)} L${num(side * edgeX * 0.5)} ${num(edgeY - 4)}` }))
    }
  }
  return g([
    el('path', { d: bladePath(w, h), fill: SAGE, stroke: INK, 'stroke-width': 5, 'stroke-linejoin': 'round' }),
    g(slits, { fill: 'none', stroke: CREAM, 'stroke-width': 17, 'stroke-linecap': 'round' }),
    stroke(`M0 -12 L0 ${num(-h + 18)}`, 4, INK, { 'stroke-opacity': 0.3 })
  ], { transform: tf(x, y, rotate) })
}

function monstera() {
  const petioles = [
    [258, 322, 22],
    [330, 250, -4],
    [452, 236, 12],
    [534, 330, 26]
  ]
  const leaves = [
    { x: 258, y: 322, w: 232, h: 252, rotate: -46 },
    { x: 330, y: 250, w: 244, h: 272, rotate: -18 },
    { x: 452, y: 236, w: 234, h: 262, rotate: 16 },
    { x: 534, y: 330, w: 214, h: 238, rotate: 48 }
  ]
  const parts = []
  for (const [x, y, bend] of petioles) {
    parts.push(...stemmedStem(CENTER, BASE_Y, x, y + 10, 12, bend, 40))
  }
  for (const leaf of leaves) {
    parts.push(monsteraLeaf(leaf.x, leaf.y, leaf.w, leaf.h, leaf.rotate))
  }
  return parts
}

function ficus() {
  const trunk = 'M384 440 L392 292 L408 292 L416 440 Z'
  const branches = [
    'M400 316 Q366 288 322 262',
    'M400 300 Q436 268 476 248',
    'M400 340 Q372 330 344 336',
    'M402 296 Q400 244 396 210',
    'M404 330 Q444 322 470 300'
  ]
  const parts = [
    el('path', { d: trunk, fill: INK, 'fill-opacity': 0.85, stroke: INK, 'stroke-width': 4, 'stroke-linejoin': 'round' })
  ]
  for (const branch of branches) {
    parts.push(stroke(branch, 9, INK, { 'stroke-opacity': 0.85 }))
  }
  const canopy = [
    [322, 262, -62], [300, 232, -96], [336, 224, -34], [302, 196, -74],
    [476, 248, 46], [500, 216, 84], [470, 194, 38], [506, 180, 74],
    [344, 336, -108], [330, 300, -146], [312, 306, -120],
    [396, 210, -12], [376, 176, -32], [416, 176, 26], [402, 146, 4],
    [470, 300, 96], [494, 282, 66], [452, 268, 34]
  ]
  const leaves = canopy.map(([x, y, rotate]) => el('path', { d: absoluteBlade(x, y, 58, 82, rotate) }))
  parts.push(g(leaves, { fill: SAGE, 'fill-opacity': 0.92, stroke: INK, 'stroke-width': 4, 'stroke-linejoin': 'round' }))
  return parts
}

function sansevieria() {
  const swords = [
    { x: 400, y: 438, w: 58, h: 330, rotate: -2, fill: SAGE },
    { x: 380, y: 438, w: 52, h: 292, rotate: -18, fill: SAGE },
    { x: 424, y: 438, w: 54, h: 300, rotate: 16, fill: SAGE },
    { x: 354, y: 438, w: 46, h: 244, rotate: -34, fill: SAGE },
    { x: 450, y: 438, w: 48, h: 252, rotate: 32, fill: SAGE },
    { x: 400, y: 438, w: 40, h: 356, rotate: 4, fill: SAGE }
  ]
  const parts = []
  for (const sword of swords) {
    const bands = []
    for (const f of [0.22, 0.38, 0.54, 0.7, 0.84]) {
      const width = sword.w * 0.28 * (1 - f * 0.6)
      bands.push(el('path', { d: `M${num(-width)} ${num(-sword.h * f)} L${num(width)} ${num(-sword.h * f)}` }))
    }
    parts.push(g([
      el('path', { d: swordPath(sword.w, sword.h), fill: sword.fill, stroke: INK, 'stroke-width': 5, 'stroke-linejoin': 'round' }),
      g(bands, { fill: 'none', stroke: CREAM, 'stroke-width': 7, 'stroke-opacity': 0.6, 'stroke-linecap': 'round' }),
      stroke(`M0 -8 L0 ${num(-sword.h + 20)}`, 3, INK, { 'stroke-opacity': 0.25 })
    ], { transform: tf(sword.x, sword.y, sword.rotate) }))
  }
  return parts
}

function spathiphyllum() {
  const leaves = [
    { x: 400, y: 320, w: 132, h: 300, rotate: -4 },
    { x: 356, y: 344, w: 122, h: 274, rotate: -32 },
    { x: 446, y: 344, w: 122, h: 274, rotate: 28 },
    { x: 318, y: 372, w: 110, h: 236, rotate: -58 },
    { x: 484, y: 372, w: 110, h: 236, rotate: 54 },
    { x: 400, y: 380, w: 104, h: 210, rotate: 8 }
  ]
  const parts = []
  for (const leaf of leaves) {
    parts.push(...stemmedStem(CENTER, BASE_Y, leaf.x, leaf.y + 8, 10, 0, 26))
  }
  for (const leaf of leaves) {
    parts.push(blade({
      x: leaf.x,
      y: leaf.y,
      w: leaf.w,
      h: leaf.h,
      rotate: leaf.rotate,
      fill: INK,
      fillOpacity: 0.86,
      strokeWidth: 5,
      veins: 1,
      veinColor: CREAM,
      veinOpacity: 0.28
    }))
  }
  for (const spathe of [
    { x: 336, y: 286, rotate: -24 },
    { x: 470, y: 210, rotate: 18 }
  ]) {
    parts.push(...stemmedStem(CENTER, BASE_Y, spathe.x, spathe.y, 8, 30, 20))
    parts.push(g([
      el('path', { d: spathePath(146, 188), fill: CREAM, stroke: INK, 'stroke-width': 5, 'stroke-linejoin': 'round' }),
      stroke('M0 -10 L0 -104', 17, TEAL, { 'stroke-opacity': 0.85 })
    ], { transform: tf(spathe.x, spathe.y, spathe.rotate) }))
  }
  return parts
}

function pinnateStem(tipX, tipY, leafletScale) {
  const dx = tipX - CENTER
  const dy = tipY - BASE_Y
  const length = Math.hypot(dx, dy)
  const nx = -dy / length
  const ny = dx / length
  const leaflets = []
  const count = 5
  for (let index = 1; index <= count; index += 1) {
    const f = index / (count + 1)
    const pointX = CENTER + dx * f
    const pointY = BASE_Y + dy * f
    const size = leafletScale * (0.5 + 0.62 * f)
    for (const side of [-1, 1]) {
      const offX = nx * side * 18 * size
      const offY = ny * side * 18 * size
      const rotate = Math.atan2(offX, -offY) * 180 / Math.PI
      leaflets.push(el('path', {
        d: absoluteBlade(pointX + offX, pointY + offY, 40 * size, 54 * size, rotate),
        'fill-opacity': 0.96
      }))
    }
  }
  const stemPath = `M${CENTER} ${BASE_Y} L${num(tipX)} ${num(tipY)}`
  return [
    g(leaflets, { fill: SAGE, stroke: INK, 'stroke-width': 3.5, 'stroke-linejoin': 'round' }),
    stroke(stemPath, 6, INK, { 'stroke-opacity': 0.9 })
  ]
}

function zamioculcas() {
  const tips = [
    [236, 214, 0.9],
    [330, 128, 1.02],
    [424, 104, 1.05],
    [518, 140, 0.98],
    [580, 236, 0.86]
  ]
  const parts = []
  for (const [x, y, scale] of tips) {
    parts.push(...pinnateStem(x, y, scale))
  }
  return parts
}

function chlorophytum() {
  const ribbons = [
    { rotate: -74, bend: -96, h: 300, w: 40 },
    { rotate: -52, bend: -74, h: 330, w: 44 },
    { rotate: -28, bend: -44, h: 296, w: 46 },
    { rotate: -9, bend: -13, h: 244, w: 44 },
    { rotate: 9, bend: 13, h: 244, w: 44 },
    { rotate: 28, bend: 44, h: 296, w: 46 },
    { rotate: 52, bend: 74, h: 330, w: 44 },
    { rotate: 74, bend: 96, h: 300, w: 40 },
    { rotate: 0, bend: 0, h: 206, w: 42 }
  ]
  const parts = []
  for (const ribbon of ribbons) {
    parts.push(g([
      el('path', { d: ribbonPath(ribbon.bend, ribbon.h, ribbon.w), fill: SAGE, stroke: INK, 'stroke-width': 5, 'stroke-linejoin': 'round' }),
      el('path', { d: ribbonPath(ribbon.bend, ribbon.h * 0.94, ribbon.w * 0.34), fill: CREAM, 'fill-opacity': 0.62 })
    ], { transform: tf(CENTER, BASE_Y, ribbon.rotate) }))
  }
  const droops = [
    { x: 232, y: 268, rotate: -40 },
    { x: 566, y: 284, rotate: 38 }
  ]
  for (const droop of droops) {
    parts.push(stroke(`M${CENTER} ${num(BASE_Y - 40)} C${num(CENTER + (droop.x - CENTER) * 0.4)} ${num(BASE_Y - 170)} ${num(droop.x + 20)} ${num(droop.y - 90)} ${num(droop.x)} ${num(droop.y)}`, 6, SAGE))
    const babies = []
    for (const angle of [-58, -30, 0, 30, 58]) {
      babies.push(el('path', {
        d: ribbonPath(angle * 0.6, 74, 22),
        fill: SAGE,
        'fill-opacity': 0.95,
        stroke: INK,
        'stroke-width': 4,
        'stroke-linejoin': 'round'
      }))
    }
    parts.push(g(babies, { transform: tf(droop.x, droop.y, droop.rotate) }))
    parts.push(stroke(`M${num(droop.x - 6)} ${num(droop.y + 8)} L${num(droop.x - 12)} ${num(droop.y + 34)}`, 4, INK, { 'stroke-opacity': 0.5 }))
    parts.push(stroke(`M${num(droop.x + 6)} ${num(droop.y + 8)} L${num(droop.x + 12)} ${num(droop.y + 34)}`, 4, INK, { 'stroke-opacity': 0.5 }))
  }
  return parts
}

function cane(x, topY, width) {
  const left = x - width / 2
  const right = x + width / 2
  const parts = [
    el('path', { d: `M${num(left)} 440 L${num(left + 3)} ${num(topY)} L${num(right - 3)} ${num(topY)} L${num(right)} 440 Z`, fill: INK, 'fill-opacity': 0.82, stroke: INK, 'stroke-width': 4, 'stroke-linejoin': 'round' })
  ]
  const rings = []
  for (const f of [0.25, 0.5, 0.75]) {
    const y = 440 - (440 - topY) * f
    rings.push(el('path', { d: `M${num(left + 2)} ${num(y)} L${num(right - 2)} ${num(y - 5)}` }))
  }
  parts.push(g(rings, { fill: 'none', stroke: CREAM, 'stroke-width': 4, 'stroke-opacity': 0.35, 'stroke-linecap': 'round' }))
  return parts
}

function rosette(x, y, count, leafWidth, leafHeight, spread) {
  const leaves = []
  for (let index = 0; index < count; index += 1) {
    const f = count === 1 ? 0.5 : index / (count - 1)
    const rotate = -spread + spread * 2 * f
    leaves.push(el('path', {
      d: absoluteBlade(x, y, leafWidth * (1 - Math.abs(f - 0.5) * 0.28), leafHeight * (0.72 + 0.28 * Math.sin(Math.PI * f)), rotate),
      'fill-opacity': 0.96
    }))
  }
  return [g(leaves, { fill: SAGE, stroke: INK, 'stroke-width': 4, 'stroke-linejoin': 'round' })]
}

function dracaena() {
  return [
    ...cane(400, 212, 30),
    ...rosette(400, 214, 11, 36, 186, 78),
    ...cane(324, 322, 24),
    ...rosette(324, 324, 7, 30, 138, 70)
  ]
}

function begoniaFlower(x, y, radius, rotate) {
  const petals = []
  for (let index = 0; index < 5; index += 1) {
    const angle = rotate + index * 72
    petals.push(g([
      el('ellipse', { cx: 0, cy: num(-radius * 0.88), rx: num(radius * 0.62), ry: num(radius * 0.78) })
    ], { transform: `rotate(${num(angle)})` }))
  }
  petals.push(el('circle', { cx: 0, cy: 0, r: num(radius * 0.36), fill: TEAL, stroke: INK, 'stroke-width': 3 }))
  return g(petals, { fill: CREAM, stroke: INK, 'stroke-width': 4, transform: tf(x, y) })
}

function begonia() {
  const leaves = [
    { x: 322, y: 322, w: 168, h: 196, rotate: -58 },
    { x: 356, y: 344, w: 156, h: 186, rotate: -32 },
    { x: 400, y: 336, w: 150, h: 200, rotate: -4 },
    { x: 444, y: 344, w: 156, h: 186, rotate: 26 },
    { x: 480, y: 326, w: 162, h: 192, rotate: 54 },
    { x: 400, y: 386, w: 140, h: 158, rotate: 8 }
  ]
  const parts = []
  for (const leaf of leaves) {
    parts.push(...stemmedStem(CENTER, BASE_Y, leaf.x, leaf.y + 6, 9, 0, 22))
  }
  for (const leaf of leaves) {
    const veins = []
    for (const [side, t] of [[1, 0.42], [1, 0.6], [1, 0.78], [-1, 0.5], [-1, 0.7]]) {
      const edge = asymEdgePoint(t, leaf.w, leaf.h, side)
      veins.push(el('path', {
        d: `M${num(side * 3)} -16 Q${num(edge.x * 0.4)} ${num(edge.y * 0.5)} ${num(edge.x * 0.7)} ${num(edge.y * 0.92)}`
      }))
    }
    parts.push(g([
      el('path', { d: asymPath(leaf.w, leaf.h), fill: SAGE, stroke: INK, 'stroke-width': 5, 'stroke-linejoin': 'round' }),
      g(veins, { fill: 'none', stroke: CREAM, 'stroke-width': 3.5, 'stroke-opacity': 0.5, 'stroke-linecap': 'round' })
    ], { transform: tf(leaf.x, leaf.y, leaf.rotate) }))
  }
  parts.push(...stemmedStem(400, 360, 300, 232, 7, -20, 10))
  parts.push(begoniaFlower(300, 232, 40, 6))
  parts.push(...stemmedStem(400, 344, 502, 216, 7, 22, 10))
  parts.push(begoniaFlower(502, 216, 36, 24))
  parts.push(begoniaFlower(404, 176, 34, 44))
  return parts
}

function kalanchoeFlowerCluster(x, y) {
  const parts = [stroke(`M${x} ${y + 96} L${x} ${y + 8}`, 10, SAGE)]
  const rows = [
    { count: 5, radius: 24, offset: -34 },
    { count: 4, radius: 22, offset: 0 },
    { count: 3, radius: 22, offset: 30 },
    { count: 1, radius: 24, offset: -62 }
  ]
  for (const row of rows) {
    for (let index = 0; index < row.count; index += 1) {
      const spread = (index - (row.count - 1) / 2) * (row.radius * 1.9)
      parts.push(el('circle', { cx: num(x + spread), cy: num(y + row.offset), r: row.radius, fill: CREAM, stroke: INK, 'stroke-width': 4 }))
      parts.push(el('circle', { cx: num(x + spread), cy: num(y + row.offset), r: num(row.radius * 0.34), fill: TEAL }))
    }
  }
  return parts
}

function kalanchoe() {
  const leaves = [
    { x: 306, y: 376, w: 132, h: 168, rotate: -66 },
    { x: 348, y: 388, w: 140, h: 176, rotate: -38 },
    { x: 400, y: 380, w: 144, h: 186, rotate: -6 },
    { x: 454, y: 388, w: 140, h: 176, rotate: 36 },
    { x: 496, y: 378, w: 132, h: 166, rotate: 64 },
    { x: 322, y: 412, w: 122, h: 140, rotate: -80 },
    { x: 478, y: 412, w: 122, h: 140, rotate: 78 },
    { x: 400, y: 414, w: 116, h: 132, rotate: 4 }
  ]
  const parts = []
  for (const leaf of leaves) {
    parts.push(g([
      el('path', { d: scallopPath(leaf.w, leaf.h), fill: SAGE, stroke: INK, 'stroke-width': 5, 'stroke-linejoin': 'round' }),
      stroke(`M0 -10 L0 ${num(-leaf.h + 18)}`, 4, CREAM, { 'stroke-opacity': 0.45 })
    ], { transform: tf(leaf.x, leaf.y, leaf.rotate) }))
  }
  parts.push(...kalanchoeFlowerCluster(400, 214))
  return parts
}

function orchidFlower(x, y, radius, rotate) {
  const petals = []
  for (let index = 0; index < 5; index += 1) {
    const angle = rotate - 90 + index * 72
    petals.push(g([
      el('ellipse', { cx: 0, cy: num(-radius * 1.02), rx: num(radius * 0.66), ry: num(radius * 0.95) })
    ], { transform: `rotate(${num(angle)})` }))
  }
  petals.push(g([
    el('ellipse', { cx: 0, cy: num(-radius * 0.5), rx: num(radius * 0.52), ry: num(radius * 0.44), fill: TEAL }),
    el('circle', { cx: 0, cy: num(-radius * 0.44), r: num(radius * 0.16), fill: CREAM, stroke: 'none' })
  ]))
  return g(petals, { fill: CREAM, stroke: INK, 'stroke-width': 4, transform: tf(x, y, rotate * 0.2) })
}

function orchid() {
  const leaves = [
    { x: 400, y: 418, w: 168, h: 208, rotate: -76 },
    { x: 412, y: 424, w: 176, h: 214, rotate: -46 },
    { x: 430, y: 428, w: 166, h: 196, rotate: 22 },
    { x: 400, y: 432, w: 154, h: 182, rotate: -14 }
  ]
  const parts = []
  for (const leaf of leaves) {
    parts.push(blade({
      x: leaf.x,
      y: leaf.y,
      w: leaf.w,
      h: leaf.h,
      rotate: leaf.rotate,
      fill: INK,
      fillOpacity: 0.84,
      strokeWidth: 5,
      veins: 2,
      veinColor: CREAM,
      veinOpacity: 0.24
    }))
  }
  const spike = {
    p0: { x: 430, y: 428 },
    p1: { x: 486, y: 336 },
    p2: { x: 528, y: 232 },
    p3: { x: 496, y: 112 }
  }
  const spikePath = `M${spike.p0.x} ${spike.p0.y} C${spike.p1.x} ${spike.p1.y} ${spike.p2.x} ${spike.p2.y} ${spike.p3.x} ${spike.p3.y}`
  parts.push(stroke(spikePath, 16, INK))
  parts.push(stroke(spikePath, 9, SAGE))
  const flowers = [
    { t: 0.32, side: -1, radius: 42 },
    { t: 0.52, side: 1, radius: 40 },
    { t: 0.7, side: -1, radius: 38 },
    { t: 0.86, side: 1, radius: 34 }
  ]
  for (const flower of flowers) {
    const point = cubicPoint(spike.p0, spike.p1, spike.p2, spike.p3, flower.t)
    const x = point.x + flower.side * flower.radius * 0.82
    const y = point.y - flower.radius * 0.28
    parts.push(stroke(`M${num(point.x)} ${num(point.y)} L${num(x)} ${num(y)}`, 5, SAGE))
    parts.push(orchidFlower(x, y, flower.radius, flower.side * 22))
  }
  const bud = cubicPoint(spike.p0, spike.p1, spike.p2, spike.p3, 0.96)
  parts.push(el('ellipse', { cx: num(bud.x), cy: num(bud.y - 14), rx: 16, ry: 26, fill: CREAM, stroke: INK, 'stroke-width': 4, transform: `rotate(18 ${num(bud.x)} ${num(bud.y - 14)})` }))
  return parts
}

const ILLUSTRATIONS = [
  { slug: 'monstera', label: 'крупные рассечённые листья на длинных черешках', draw: monstera },
  { slug: 'ficus-benjamina', label: 'древесный ствол с ветвями и множество мелких овальных листьев', draw: ficus },
  { slug: 'sansevieria', label: 'пучок вертикальных мечевидных листьев с поперечными полосами', draw: sansevieria },
  { slug: 'spathiphyllum', label: 'тёмные листья и два белых покрывала соцветий', draw: spathiphyllum },
  { slug: 'zamioculcas', label: 'пять прямостоячих перистых стеблей с парными листочками', draw: zamioculcas },
  { slug: 'chlorophytum', label: 'дуговидные полосатые листья и детки на отпрысках', draw: chlorophytum },
  { slug: 'dracaena', label: 'два голых стебля с колючими розетками на верхушках', draw: dracaena },
  { slug: 'begonia', label: 'асимметричные листья с прожилками и три мелких цветка', draw: begonia },
  { slug: 'kalanchoe', label: 'округлые городчатые листья и шапка мелких цветков', draw: kalanchoe },
  { slug: 'orchid-phalaenopsis', label: 'широкие прикорневые листья и дугообразный цветонос с четырьмя цветками', draw: orchid }
]

async function readSlugs() {
  try {
    const module = await import(pathToFileURL(plantsSource).href)
    if (Array.isArray(module.PLANTS)) {
      return {
        slugs: module.PLANTS.map(plant => plant?.slug).filter(slug => typeof slug === 'string'),
        source: 'import'
      }
    }
  } catch (error) {
    console.warn(`Не удалось импортировать plants.js (${error.message}); читаю слаги регулярным выражением`)
  }
  const text = await readFile(plantsSource, 'utf8')
  const slugs = []
  for (const match of text.matchAll(/slug:\s*'([^']+)'/g)) {
    slugs.push(match[1])
  }
  return { slugs, source: 'parse' }
}

const { slugs: discovered, source } = await readSlugs()
const known = new Set(ILLUSTRATIONS.map(illustration => illustration.slug))
const missing = [...known].filter(slug => !discovered.includes(slug))
const unknown = discovered.filter(slug => !known.has(slug))

await mkdir(outputDir, { recursive: true })

const rows = []
for (const illustration of ILLUSTRATIONS) {
  const markup = frame(illustration.draw())
  const bytes = Buffer.byteLength(markup, 'utf8')
  await writeFile(resolve(outputDir, `${illustration.slug}.svg`), markup, 'utf8')
  rows.push({ slug: illustration.slug, bytes, label: illustration.label })
}

console.log(`Источник слагов: ${source} (${plantsSource})`)
if (missing.length) {
  console.warn(`Нет в plants.js: ${missing.join(', ')}`)
}
if (unknown.length) {
  console.warn(`Слаги без иллюстрации (пропущены): ${unknown.join(', ')}`)
}
console.log('')
for (const row of rows) {
  console.log(`${row.slug.padEnd(22)} ${String(row.bytes).padStart(6)} B  < 12 KB: ${row.bytes < 12288 ? 'да' : 'НЕТ'}`)
}
console.log('')
console.log(`Всего файлов: ${rows.length}, суммарно ${rows.reduce((sum, row) => sum + row.bytes, 0)} B`)
