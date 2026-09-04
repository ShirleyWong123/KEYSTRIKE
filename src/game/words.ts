import { LEVELS } from './config';
import type { Difficulty } from './types';

const words = (value: string): readonly string[] => value.split(' ');

// Short, familiar words keep the opening pace approachable.
const EASY = words(`cat dog sun moon star rain snow wind fire tree rock lake hill road home room door book game word time hand face head foot fish bird ship farm milk bread apple grape lemon green black white brown happy quick quiet small large round light sound heart dream plant water earth world house table chair phone music sleep smile laugh dance jump run walk talk look make take give keep turn move stop open close start young old new good kind warm cool soft hard fast slow blue red pink gold king queen child adult buddy party beach river cloud grass sweet clear brave calm clean fresh sharp shine clock train plane truck bike horse storm trail bunny ocean candy`).filter((word, index, list) => list.indexOf(word) === index);

// Common words with enough variety to keep normal play from feeling repetitive.
const NORMAL = words(`able about above action after again air alarm alone along angry answer apple argue arise army audio avoid aware baby back bag basic beach begin being below black blood board brain break bring broad brown build busy carry cause center chain chair chance change check child choice city class clean clear climb clock close color common count court cover cream cross crowd daily dance death deep drive early earth eight enjoy enter equal event every exact face fact fair family field fight final find first flame floor focus force forty found frame fresh front fruit funny giant glass glove going green group happy heart heavy hello horse hotel house human image inner issue joint judge juice known label large later laugh learn leave level light limit local logic lucky lunch machine major make match maybe mean metal money month motor mouth movie music never night noise north notice ocean offer often order other paper party peace phone piece place plain plane plant point power press price prime print proof proud quiet quick radio raise reach ready real reason record red right river rough round route royal safe scale scene school score screen serve seven shape share sharp sheep sheet shift short sight since skill sleep small smile solid sound south space speak speed sport spring square stand start state steam steel stick stone story street strong study style sugar sunny table taste teach team thank thing think third three throw today together touch tower track trade train treat trial true trust truth twelve under union unit until upper usual value video visit voice watch water wheel white whole woman world worry write wrong young zero zebra`).filter((word, index, list) => list.indexOf(word) === index && word.length >= 4 && word.length <= 8);

// Longer words add pressure without relying on proper nouns or abbreviations.
const HARD = words(`airport already another balance between blanket blossom borderless building captain careful careless ceiling central chamber charity chicken choose circle climate collect comfort command compare complete computer concert connect country courage crowded curious customer daughter daylight declare defense deliver dentist describe design detail discover distance doctor double dragon evening example excited explore factory failure favorite feeling finance flower forever forward freedom friendly general grocery healthy highway history imagine improve include indeed journey kitchen language library lifetime little machine manager meeting message midnight morning mountain natural neither notebook nothing number observe officer outside patience pattern payment people perhaps picture planet plastic popular portion prepare present private problem process promise protect purpose quality quickly realize receive recover regular release remember replace report require respect result routine science season secure sentence service several shadow shelter should signal silver simple sister special speech spirit square station stomach strange stretch student subject success summer supply surprise system teacher temple theory thirty thought thunder ticket together tomorrow trouble twenty unable unique universe update useful valley various weather welcome western whatever whisper window winter without wonder yellow yourself`).filter((word, index, list) => list.indexOf(word) === index);

export const WORD_BANKS: Record<Difficulty, readonly string[]> = {
  easy: EASY,
  normal: NORMAL,
  hard: HARD,
};

const RANGES: Record<Difficulty, readonly [number, number]> = {
  easy: [3, 5],
  normal: [4, 8],
  hard: [6, 12],
};

type Exclusions = Iterable<string>;

const asSet = (values: Exclusions): ReadonlySet<string> =>
  values instanceof Set ? values : new Set(values);

const asLowercaseSet = (values: Exclusions): ReadonlySet<string> =>
  new Set([...values].map((value) => value.toLowerCase()));

/** Select a legal word, preferring an initial that is not already active. */
export const selectWord = (
  difficulty: Difficulty,
  level: number,
  excludedWords: Exclusions,
  excludedInitials: Exclusions,
  random: () => number = Math.random,
): string | null => {
  const excluded = asSet(excludedWords);
  const initials = asLowercaseSet(excludedInitials);
  const bank = WORD_BANKS[difficulty];
  const [minimum, maximum] = RANGES[difficulty];
  const pressure = LEVELS[Math.min(LEVELS.length, Math.max(1, Math.floor(level))) - 1] ?? LEVELS[0]!;
  const midpoint = Math.ceil((minimum + maximum) / 2);
  const legal = bank.filter((word) => !excluded.has(word) && word.length >= minimum && word.length <= maximum);
  const preferred = legal.filter((word) => !initials.has(word.charAt(0)));
  const candidates = preferred.length > 0 ? preferred : legal;
  if (candidates.length === 0) return null;

  const weights = candidates.map((word) => word.length >= midpoint ? 1 + pressure.longWordBoost : 1);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const target = Math.min(1 - Number.EPSILON, Math.max(0, random())) * total;
  let cursor = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    cursor += weights[index]!;
    if (target < cursor) return candidates[index]!;
  }
  return candidates[candidates.length - 1]!;
};
