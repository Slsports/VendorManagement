import { describe, expect, it } from 'vitest'
import { changeKind, checkName, fixName, fixVendorId, type NameContext } from './itemNameSop'

// The SOP's own examples pass with no problems.
const GOOD: [string, NameContext][] = [
  ['PATAGONIA WMNS FLEECE JACKET W/ HOOD BLUE MED', { clothing: true }],
  ["COGHLAN'S FOLDING CAMP STOOL BLUE 8256", { vidVendor: true, vendorItemId: '8256', brand: "COGHLAN'S" }],
  ["COGHLAN'S 40 OZ WATER BOTTLE BLUE 8840", { vidVendor: true, vendorItemId: '8840', brand: "COGHLAN'S" }],
  ['LAZY ONE MENS PAJAMA SET BLUE 2XL PJ5512', { clothing: true, vidVendor: true, vendorItemId: 'PJ5512' }],
  ['WFS ADULT CREW SOCKS 3 PK ASST LG 31877', { clothing: true, vidVendor: true, vendorItemId: '31877' }],
  ['COLUMBIA YTH FLEECE JACKET W/ HOOD GREEN 14/16', { clothing: true }],
  ['WFS YTH SL BEAR TEE NAVY LG(14/16) 21-4410', { clothing: true, vidVendor: true, vendorItemId: '21-4410' }],
  ['PATAGONIA TODDLER FLEECE JACKET W/ HOOD RED 3T', { clothing: true }],
  ['LAZY ONE INFANT ONESIE BEAR PRINT GRAY 6 MO IN2246', { clothing: true, vidVendor: true, vendorItemId: 'IN2246' }],
  ['LAZY ONE INFANT ONESIE BEAR PRINT GRAY 0-3 MO IN2243', { clothing: true, vidVendor: true, vendorItemId: 'IN2243' }],
  ["SCHOOL O' MINNOWS NICKEL/SILVER PRISM 3690-019-0150", { fishing: true, vendorItemId: '3690-019-0150', brand: "SCHOOL O' MINNOWS" }],
  ['TY BEANIE BOOS MEADOW FOX ORANGE REG MAR 6 36379', { ty: true, vidVendor: true, vendorItemId: '36379' }],
  ['NIKE UNISEX RUNNING SHOES BLACK/WHITE SZ 8.5', { footwear: true }],
  ['PULSE GIRLS JACKET ASPEN VIOLET YTH LG 21-3241-J', { clothing: true, vidVendor: true, vendorItemId: '21-3241-J' }],
  ["*COGHLAN'S WATER BAG 9748", { vidVendor: true, vendorItemId: '9748', brand: "COGHLAN'S" }],
  ['**ROOSTER TAIL 206 1/16 OZ FROG SPOT 368655', { fishing: true, vendorItemId: '368655' }],
]

describe('checkName on the SOP examples', () => {
  for (const [name, ctx] of GOOD) {
    it(name, () => {
      expect(checkName(name, ctx)).toEqual([])
      expect(fixName(name, ctx)).toBe(name)
    })
  }
})

describe('fixName (cosmetic and shorthand only)', () => {
  const cases: [string, NameContext, string][] = [
    ['SL MARINA WOMENS TANK TOP MARITIME FROST M', { clothing: true }, 'SL MARINA WMNS TANK TOP MARITIME FROST MED'],
    ['SL MARINA YOUTH T-SHIRT INDIGO L', { clothing: true }, 'SL MARINA YTH T-SHIRT INDIGO LG'],
    ['P-LINE FLUOROCARBON LINE 8LB 250 YD SFC250-8', { fishing: true, vendorItemId: 'SFC250-8' }, 'P-LINE FLUOROCARBON LINE 8 LB 250 YD SFC250-8'],
    ['WFS REVERSIBLE OUTDOOR MAT W/LED LIGHTS 108X144 BLUE', { vidVendor: true, vendorItemId: 'FM-73-LED' }, 'WFS REVERSIBLE OUTDOOR MAT W/ LED LIGHTS 108X144 BLUE'],
    ['NORTY MENS ARCH SUPPORT FLIP FLOPS BLACK / GRAY SZ 10', { footwear: true }, 'NORTY MENS ARCH SUPPORT FLIP FLOPS BLACK/GRAY SZ 10'],
    ['APEX - KOK KILLER 310K', { fishing: true }, 'APEX KOK KILLER 310K'],
    ['ZIP -UP HOODIE', {}, 'ZIP-UP HOODIE'],
    ['CREST TOOTHPASTE .85OZ', {}, 'CREST TOOTHPASTE .85 OZ'],
    ['RAPALA SCATTER RAP SCRCD05 FT FIRETIGER', { fishing: true }, 'RAPALA SCATTER RAP SCRCD05 FT FIRETIGER'],
    ['LIL CORKY RAINBOW  SZ12 626597', { fishing: true, vendorItemId: '626597' }, 'LIL CORKY RAINBOW SZ 12 626597'],
    ['KOKANEE APEX HOT PINK #308K', { fishing: true }, 'KOKANEE APEX HOT PINK #308K'],
    ['EAGLE CLAW HOOK #6', { fishing: true }, 'EAGLE CLAW HOOK SZ 6'],
    ['TRU TURN HOOK#8 PANFISH', { fishing: true }, 'TRU TURN HOOK#8 PANFISH'],
    ['SZ447 SUPER Z CABLES', {}, 'SZ447 SUPER Z CABLES'],
    ['SUN RAY WATER SHOES GIRLS SIZE 10', { footwear: true }, 'SUN RAY WATER SHOES GIRLS SZ 10'],
    ['TANKINI BLUE SIZE 16', { clothing: true }, 'TANKINI BLUE 16'],
    ['ATWOOD 3/8 X 50 FT ROPE', {}, "ATWOOD 3/8X50' ROPE"],
    ['LAYS KETTLE COOKED SALT & VINEGAR 8 oz', {}, 'LAYS KETTLE COOKED SALT & VINEGAR 8 OZ'],
    ['WINCHESTER BIG MIKE PAC BOOT 9', { footwear: true }, 'WINCHESTER BIG MIKE PAC BOOT SZ 9'],
    ['STILLWATER MENS SWIM TRUNK GREY SZ 36', { clothing: true }, 'STILLWATER MENS SWIM TRUNK GRAY 36'],
    ['JUNIOR GIRLS FRONT TIE BIKINI BLACK SMALL', { clothing: true }, 'JR GIRLS FRONT TIE BIKINI BLACK SM'],
    ['POKÉMON TEE XXL', { clothing: true }, 'POKEMON TEE 2XL'],
    ['* COGHLANS WATER BAG', {}, '*COGHLANS WATER BAG'],
    ['WMNS FLIP FLOP PNK BLCK SZ L 64426', { footwear: true, vidVendor: true, vendorItemId: '64426' }, 'WMNS FLIP FLOP PINK BLACK LG 64426'],
    ['I\'M A KEEPER TEE ONE-SIZE', { clothing: true, brand: 'WFS' }, "I'M A KEEPER TEE ONE SIZE"],
    ['WFS I\'M A KEEPER TEE', { clothing: true, brand: 'WFS' }, 'WFS IM A KEEPER TEE'],
    ['SUNSCREEN SPF50 3 OUNCES', {}, 'SUNSCREEN SPF 50 3 OZ'],
    ['DOG LEASH 6 FT', {}, "DOG LEASH 6'"],
    ['BAIT BAG 2LBS', {}, 'BAIT BAG 2 LBS'],
    ['ROCK SALT 1 LBS', {}, 'ROCK SALT 1 LB'],
  ]
  for (const [from, ctx, to] of cases) it(from, () => expect(fixName(from, ctx)).toBe(to))
})

describe('fixVendorId', () => {
  it('adds it last', () => expect(fixVendorId('COGHLANS STOOL BLUE', { vidVendor: true, vendorItemId: '8256' })).toBe('COGHLANS STOOL BLUE 8256'))
  it('moves it to the end', () => expect(fixVendorId('RODDY HUNTER DN548-WL FISHING COMBO', { fishing: true, vendorItemId: 'DN548-WL' })).toBe('RODDY HUNTER FISHING COMBO DN548-WL'))
  it('takes #1116 as the ID', () => expect(fixVendorId('*COGHLANS COMPRESSION SACK #1116', { vidVendor: true, vendorItemId: '1116' })).toBe('*COGHLANS COMPRESSION SACK 1116'))
  it('takes it off for other vendors', () => expect(fixVendorId('TEE NAVY MED GL1', { vendorItemId: 'GL1' })).toBe('TEE NAVY MED'))
  it('a different code at the end: a person checks', () => expect(fixVendorId('EAGLE CLAW SNELLS BRONZE 672SB-14', { fishing: true, vendorItemId: '672SBH-14' })).toBeNull())
  it('no Vendor ID in LS', () => expect(fixVendorId('LURE RED', { fishing: true })).toBeNull())
})

describe('checkName flags', () => {
  const codes = (n: string, c: NameContext = {}) => checkName(n, c).map((p) => p.code)
  it('length', () => expect(codes('A'.repeat(53))).toContain('length'))
  it('length exception', () => expect(codes('A'.repeat(53), { lengthException: true })).not.toContain('length'))
  it('duplicate', () => expect(codes('TEE BLUE MED', { otherNames: new Set(['TEE BLUE MED']) })).toContain('duplicate'))
  it('asterisk in the middle', () => expect(codes('TEE * BLUE')).toContain('marker'))
  it('vendor ID missing', () => expect(codes('COGHLANS STOOL', { vidVendor: true, vendorItemId: '8256' })).toContain('vendor_id'))
  it('vendor ID not wanted', () => expect(codes('TEE 8256', { vendorItemId: '8256' })).toContain('vendor_id_extra'))
  it('YTH GIRLS', () => expect(codes('PULSE YTH GIRLS JACKET LG', { clothing: true })).toContain('sizing'))
  it('fishing colors off fishing', () => expect(codes('TEE BLK MED', { clothing: true })).toContain('colors'))
  it('fishing colors on fishing are fine', () => expect(codes('LURE BLK 123', { fishing: true, vendorItemId: '123' })).toEqual([]))
  it('lowercase', () => expect(codes('Tee Blue')).toContain('lowercase'))
  it('four colors', () => expect(codes('TEE RED/WHITE/BLUE/GREEN MED')).toContain('colors'))
})

describe('changeKind', () => {
  it('shorthand only is cosmetic', () => {
    expect(changeKind('SL MARINA YOUTH T-SHIRT INDIGO L', 'SL MARINA YTH T-SHIRT INDIGO LG')).toBe('cosmetic')
    expect(changeKind('NORTY FLIP FLOPS BLACK / GREY SZ 10', 'NORTY FLIP FLOPS BLACK/GRAY SZ 10')).toBe('cosmetic')
    expect(changeKind('COGHLANS STOOL', '*COGHLANS STOOL')).toBe('cosmetic')
    expect(changeKind('Shaver Lake Mug 12 oz', 'SL MUG 12 OZ')).toBe('cosmetic')
  })
  it('different words, color, size or Vendor ID is content', () => {
    expect(changeKind('TEE BLUE MED', 'TEE NAVY MED')).toBe('content')
    expect(changeKind('TEE BLUE MED', 'TEE BLUE LG')).toBe('content')
    expect(changeKind('COGHLANS STOOL', 'COGHLANS STOOL 8256')).toBe('content')
  })
  it('same', () => expect(changeKind('A', 'A')).toBe('same'))
})
