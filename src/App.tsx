import {
  ArrowDown,
  ArrowRight,
  BarChart3,
  BadgeCheck,
  Calculator,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  FileSpreadsheet,
  Info,
  Megaphone,
  PackageCheck,
  ReceiptText,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import {
  type CSSProperties,
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  calculateBreakEvenDiscountBps,
  calculateMaxDiscountForMarginBps,
  calculateTransaction,
  DEFAULT_INPUT,
  solvePriceForMargin,
  solvePriceForProfit,
} from './domain/engine';
import {
  DEFAULT_FEE_SCHEDULE,
  getEbayCategories,
  getEbayInsertionFee,
  getEbaySellerPlanRule,
} from './domain/fees/config';
import {
  centsToInput,
  clampBasisPoints,
  dollarsToCents,
  formatMoney,
  formatPercent,
} from './domain/money';
import {
  calculateSalesGoal,
  compareAdvertisingCost,
  compareDiscount,
  compareFreeShipping,
  compareSaleSource,
} from './domain/scenarios';
import { trackEvent } from './analytics';
import { getRouteContent, type RouteToolId } from './route-content';
import type {
  CalculationResult,
  FeeSchedule,
  MarketplaceId,
  Money,
  SavedCalculation,
  TransactionInput,
} from './domain/types';

type FeeLoadStatus = 'checking' | 'ready' | 'fallback';

type ToolId = RouteToolId;
type MoneyKey =
  | 'sellingPrice'
  | 'customerShippingCharge'
  | 'marketplaceCollectedTax'
  | 'productCost'
  | 'packagingCost'
  | 'sellerShippingCost'
  | 'advertisingCost'
  | 'otherCosts';

const MARKETPLACE_LABELS: Record<MarketplaceId, string> = {
  etsy: 'Etsy',
  ebay: 'eBay',
  direct: 'Direct sale',
  custom: 'Custom',
};

const DECISION_TOOLS = [
  ['pricing', Target, 'Price goal'],
  ['discount', BarChart3, 'Sale discount'],
  ['shipping', Truck, 'Free shipping'],
  ['ads', Megaphone, 'Ad impact'],
  ['goal', Calculator, 'Sales goal'],
] as const;

function currentRoute() {
  return getRouteContent(window.location.pathname);
}

function normalizeInput(value: Partial<TransactionInput>, marketplace?: MarketplaceId): TransactionInput {
  const legacySettings = (value.settings ?? {}) as Partial<TransactionInput['settings']> & {
    etsyOffsiteAdsRateBps?: number;
  };
  const legacyOffsiteRate = legacySettings.etsyOffsiteAdsRateBps ?? 0;
  const promotedRate = legacySettings.ebayPromotedListingRateBps ?? 0;
  return {
    ...DEFAULT_INPUT,
    ...value,
    discountBps: clampBasisPoints(value.discountBps ?? DEFAULT_INPUT.discountBps),
    marketplace: marketplace ?? value.marketplace ?? DEFAULT_INPUT.marketplace,
    settings: {
      ...DEFAULT_INPUT.settings,
      ...legacySettings,
      sellerRegion: legacySettings.sellerRegion ?? 'US',
      etsySaleSource:
        legacySettings.etsySaleSource ?? (legacyOffsiteRate > 0 ? 'offsite' : 'organic'),
      etsyOffsiteAdsTier:
        legacySettings.etsyOffsiteAdsTier
        ?? (legacyOffsiteRate === 1_200 ? 'reduced' : legacyOffsiteRate > 0 ? 'standard' : 'unselected'),
      ebaySaleSource:
        legacySettings.ebaySaleSource ?? (promotedRate > 0 ? 'promoted' : 'organic'),
    },
  };
}

function loadDraft(): TransactionInput {
  const route = currentRoute();
  try {
    const raw = window.localStorage.getItem('seller-margin-draft-v1');
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TransactionInput>;
      return normalizeInput(parsed, route.marketplace);
    }
  } catch {
    // A malformed local draft should never stop the calculator from loading.
  }
  return normalizeInput(DEFAULT_INPUT, route.marketplace);
}

function loadSaved(): SavedCalculation[] {
  try {
    const raw = window.localStorage.getItem('seller-margin-saved-v1');
    if (!raw) return [];
    return (JSON.parse(raw) as SavedCalculation[]).map((record) => ({
      ...record,
      input: normalizeInput(record.input),
    }));
  } catch {
    return [];
  }
}

function isFeeSchedule(value: unknown): value is FeeSchedule {
  if (!value || typeof value !== 'object') return false;
  const schedule = value as Partial<FeeSchedule>;
  return (
    schedule.schemaVersion === 2 &&
    schedule.region === 'US' &&
    schedule.currency === 'USD' &&
    typeof schedule.checkedAt === 'string' &&
    typeof schedule.etsy?.transactionRateBps === 'number' &&
    typeof schedule.ebay?.categories?.most?.firstRateBps === 'number' &&
    typeof schedule.ebay?.storeCategories?.most?.firstRateBps === 'number' &&
    typeof schedule.ebay?.sellerPlans?.['no-store']?.label === 'string' &&
    typeof schedule.ebay?.performanceSurcharges?.['below-standard-long-term'] === 'number' &&
    typeof schedule.profiles?.etsy?.version === 'string' &&
    typeof schedule.sourceStatus?.ebayStore === 'string' &&
    typeof schedule.sourceCheckedAt?.ebayStore === 'string'
  );
}

function formatCheckedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'recently';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

interface CurrencyInputProps {
  id: string;
  label: string;
  value: Money;
  onChange: (value: Money) => void;
  hint?: string;
  emphasized?: boolean;
}

function CurrencyInput({ id, label, value, onChange, hint, emphasized }: CurrencyInputProps) {
  const [draft, setDraft] = useState(centsToInput(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(centsToInput(value));
  }, [value]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setDraft(event.target.value);
    onChange(dollarsToCents(event.target.value));
  };

  return (
    <label className={`field ${emphasized ? 'field-emphasized' : ''}`} htmlFor={id}>
      <span className="field-label">{label}</span>
      <span className="currency-control">
        <span aria-hidden="true">$</span>
        <input
          ref={inputRef}
          id={id}
          inputMode="decimal"
          min="0"
          step="0.01"
          value={draft}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={handleChange}
          onBlur={() => setDraft(centsToInput(value))}
        />
      </span>
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </label>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' }) {
  return (
    <div className="metric-row">
      <span>{label}</span>
      <strong className={tone ? `text-${tone}` : ''}>{value}</strong>
    </div>
  );
}

function ScenarioCard({
  eyebrow,
  title,
  result,
  note,
  highlighted,
}: {
  eyebrow: string;
  title: string;
  result: CalculationResult;
  note?: string;
  highlighted?: boolean;
}) {
  return (
    <article className={`scenario-card ${highlighted ? 'scenario-card-highlighted' : ''}`}>
      <span className="scenario-eyebrow">{eyebrow}</span>
      <h4>{title}</h4>
      {result.status === 'blocked' ? (
        <div className="scenario-unavailable">Required fee details are missing</div>
      ) : (
        <>
          <div className="scenario-profit">{formatMoney(result.profit)}</div>
          <div className="scenario-meta">
            <span>profit / sale</span>
            <span>{formatPercent(result.marginBps)} margin</span>
          </div>
        </>
      )}
      {note && <p>{note}</p>}
    </article>
  );
}

function MathTrail({
  rows,
}: {
  rows: Array<{ label: string; formula: ReactNode; note?: string }>;
}) {
  return (
    <div className="math-trail" aria-label="How these values are calculated">
      <div className="math-trail-heading"><ReceiptText size={16} /> How these values are calculated</div>
      {rows.map((row) => (
        <div className="math-trail-row" key={row.label}>
          <span>{row.label}</span>
          <div><code>{row.formula}</code>{row.note && <small>{row.note}</small>}</div>
        </div>
      ))}
    </div>
  );
}

function App() {
  const route = currentRoute();
  const [input, setInput] = useState<TransactionInput>(loadDraft);
  const [showMore, setShowMore] = useState(route.marketplace === 'ebay');
  const [activeTool, setActiveTool] = useState<ToolId>(route.tool ?? 'pricing');
  const [targetMarginPercent, setTargetMarginPercent] = useState(40);
  const [targetProfit, setTargetProfit] = useState<Money>(2_000);
  const [monthlyTarget, setMonthlyTarget] = useState<Money>(100_000);
  const [saved, setSaved] = useState<SavedCalculation[]>(loadSaved);
  const [showSaved, setShowSaved] = useState(false);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [notice, setNotice] = useState('');
  const [profitPackInterest, setProfitPackInterest] = useState(false);
  const [feeSchedule, setFeeSchedule] = useState<FeeSchedule>(DEFAULT_FEE_SCHEDULE);
  const [feeLoadStatus, setFeeLoadStatus] = useState<FeeLoadStatus>('checking');
  const calculatorInteracted = useRef(false);
  const completionTracked = useRef(false);
  const assumptionDialogRef = useRef<HTMLElement>(null);
  const focusBeforeDialog = useRef<HTMLElement | null>(null);

  const result = useMemo(() => calculateTransaction(input, feeSchedule), [input, feeSchedule]);
  const marginPrice = useMemo(
    () => solvePriceForMargin(input, Math.round(targetMarginPercent * 100), feeSchedule),
    [input, targetMarginPercent, feeSchedule],
  );
  const profitPrice = useMemo(
    () => solvePriceForProfit(input, targetProfit, feeSchedule),
    [input, targetProfit, feeSchedule],
  );
  const marginPriceResult = useMemo(
    () =>
      marginPrice === null
        ? null
        : calculateTransaction(
            { ...input, sellingPrice: marginPrice, discountBps: 0 },
            feeSchedule,
          ),
    [input, marginPrice, feeSchedule],
  );
  const profitPriceResult = useMemo(
    () =>
      profitPrice === null
        ? null
        : calculateTransaction(
            { ...input, sellingPrice: profitPrice, discountBps: 0 },
            feeSchedule,
          ),
    [input, profitPrice, feeSchedule],
  );
  const discountComparison = useMemo(
    () => compareDiscount(input, feeSchedule),
    [input, feeSchedule],
  );
  const breakEvenDiscount = useMemo(
    () => calculateBreakEvenDiscountBps(input, feeSchedule),
    [input, feeSchedule],
  );
  const targetSafeDiscount = useMemo(
    () => calculateMaxDiscountForMarginBps(input, Math.round(targetMarginPercent * 100), feeSchedule),
    [input, targetMarginPercent, feeSchedule],
  );
  const shippingComparison = useMemo(
    () => compareFreeShipping(input, feeSchedule, Math.round(targetMarginPercent * 100)),
    [input, feeSchedule, targetMarginPercent],
  );
  const saleSourceComparison = useMemo(
    () => compareSaleSource(input, feeSchedule),
    [input, feeSchedule],
  );
  const advertisingComparison = useMemo(
    () => compareAdvertisingCost(input, feeSchedule),
    [input, feeSchedule],
  );
  const salesGoal = useMemo(() => calculateSalesGoal(result.profit, monthlyTarget), [result.profit, monthlyTarget]);

  useEffect(() => {
    window.localStorage.setItem('seller-margin-draft-v1', JSON.stringify(input));
  }, [input]);

  useEffect(() => {
    window.localStorage.setItem('seller-margin-saved-v1', JSON.stringify(saved));
  }, [saved]);

  const refreshFeeSchedule = useCallback(async () => {
    setFeeLoadStatus('checking');
    try {
      const response = await fetch('/api/fee-schedule', {
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error('Fee schedule unavailable');
      const nextSchedule: unknown = await response.json();
      if (!isFeeSchedule(nextSchedule)) throw new Error('Invalid fee schedule');
      setFeeSchedule(nextSchedule);
      setFeeLoadStatus('ready');
    } catch {
      setFeeSchedule(DEFAULT_FEE_SCHEDULE);
      setFeeLoadStatus('fallback');
    }
  }, []);

  useEffect(() => {
    void refreshFeeSchedule();
  }, [refreshFeeSchedule]);

  useEffect(() => {
    const title = `${route.eyebrow} | SellerMargin`;
    const canonicalUrl = `${window.location.origin}${window.location.pathname}`;
    const socialImageUrl = `${window.location.origin}/og-v4.png`;
    document.title = title;
    const meta = document.querySelector('meta[name="description"]');
    meta?.setAttribute('content', route.description);
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', title);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', route.description);
    document.querySelector('meta[property="og:url"]')?.setAttribute('content', canonicalUrl);
    document.querySelector('meta[property="og:image"]')?.setAttribute('content', socialImageUrl);
    document.querySelector('meta[name="twitter:title"]')?.setAttribute('content', title);
    document.querySelector('meta[name="twitter:description"]')?.setAttribute('content', route.description);
    document.querySelector('meta[name="twitter:image"]')?.setAttribute('content', socialImageUrl);
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', canonicalUrl);
    trackEvent('calculator_view', { marketplace: route.marketplace });
  }, [route.description, route.eyebrow, route.marketplace]);

  useEffect(() => {
    if (
      calculatorInteracted.current
      && !completionTracked.current
      && result.status === 'ready'
      && input.sellingPrice > 0
      && input.productCost > 0
    ) {
      completionTracked.current = true;
      trackEvent('calculator_completed', { marketplace: input.marketplace });
    }
  }, [input.marketplace, input.productCost, input.sellingPrice, result.status]);

  useEffect(() => {
    if (!showAssumptions) return;
    focusBeforeDialog.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    trackEvent('fee_assumptions_opened', { marketplace: input.marketplace });
    window.requestAnimationFrame(() => {
      assumptionDialogRef.current?.querySelector<HTMLElement>('button, [href], input, select, [tabindex]:not([tabindex="-1"])')?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowAssumptions(false);
        return;
      }
      if (event.key !== 'Tab' || !assumptionDialogRef.current) return;
      const focusable = Array.from(assumptionDialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      focusBeforeDialog.current?.focus();
    };
  }, [input.marketplace, showAssumptions]);

  const updateMoney = (key: MoneyKey, value: Money) => setInput((current) => ({ ...current, [key]: value }));
  const updateSetting = <K extends keyof TransactionInput['settings']>(
    key: K,
    value: TransactionInput['settings'][K],
  ) => setInput((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));

  const saveCalculation = () => {
    const record: SavedCalculation = {
      id: crypto.randomUUID(),
      savedAt: new Date().toISOString(),
      input,
    };
    setSaved((current) => [record, ...current].slice(0, 12));
    setNotice('Saved on this device.');
    window.setTimeout(() => setNotice(''), 2200);
  };

  const copyCalculation = async () => {
    if (result.status === 'blocked') {
      await navigator.clipboard.writeText([
        `${input.productName || 'SellerMargin calculation'} - ${MARKETPLACE_LABELS[input.marketplace]}`,
        'Calculation unavailable because required marketplace fee details are missing.',
        ...result.issues.filter((issue) => issue.severity === 'blocking').map((issue) => `Required: ${issue.message}`),
      ].join('\n'));
      setNotice('Required fee details copied.');
      window.setTimeout(() => setNotice(''), 2200);
      return;
    }
    const summary = [
      `${input.productName || 'SellerMargin calculation'} - ${MARKETPLACE_LABELS[input.marketplace]}`,
      `Regular item price: ${formatMoney(input.sellingPrice)}`,
      `Sale discount: ${formatPercent(input.discountBps, 2)}`,
      `Item revenue after discount: ${formatMoney(result.itemRevenue)}`,
      `Shipping charged to customer: ${formatMoney(input.customerShippingCharge)}`,
      `Customer pays: ${formatMoney(result.revenue)}`,
      ...(input.marketplace === 'etsy' || input.marketplace === 'ebay'
        ? [`Marketplace-collected tax used only in applicable fee bases: ${formatMoney(input.marketplaceCollectedTax)}`]
        : []),
      `Marketplace fees: ${formatMoney(result.marketplaceFees)}`,
      ...result.fees.map(
        (fee) => `  ${fee.label}: ${fee.calculation} = ${formatMoney(fee.amount)}`,
      ),
      `Entered variable costs: ${formatMoney(result.variableCosts)}`,
      ...result.costs.filter((cost) => cost.amount > 0).map(
        (cost) => `  ${cost.label}: ${formatMoney(cost.amount)}`,
      ),
      `Transaction profit: ${formatMoney(result.profit)}`,
      `Profit margin: ${formatPercent(result.marginBps)}`,
      `Fee snapshot: ${result.feeConfiguration.version}, verified ${result.feeConfiguration.lastVerifiedDate}`,
      'SellerMargin calculates transaction-level contribution profit, not accounting or tax net income.',
    ].join('\n');
    await navigator.clipboard.writeText(summary);
    setNotice('Calculation copied.');
    window.setTimeout(() => setNotice(''), 2200);
  };

  const copyDecisionSummary = async () => {
    if (result.status === 'blocked') {
      await navigator.clipboard.writeText([
        `${input.productName || 'SellerMargin decision'} — ${MARKETPLACE_LABELS[input.marketplace]}`,
        'Calculation unavailable until the required fee profile is complete.',
        ...result.issues.map((issue) => `Required: ${issue.message}`),
      ].join('\n'));
      setNotice('Required fee details copied.');
      window.setTimeout(() => setNotice(''), 2200);
      return;
    }
    const summary = [
      `${input.productName || 'SellerMargin decision'} — ${MARKETPLACE_LABELS[input.marketplace]}`,
      `Current: ${formatMoney(result.profit)} profit at ${formatPercent(result.marginBps)} margin`,
      `Price for ${targetMarginPercent}% margin: ${marginPrice === null ? 'Unavailable' : formatMoney(marginPrice)}`,
      `Price for ${formatMoney(targetProfit)} profit: ${profitPrice === null ? 'Unavailable' : formatMoney(profitPrice)}`,
      `Maximum break-even discount: ${formatPercent(breakEvenDiscount, 2)}`,
      `Maximum ${targetMarginPercent}%-margin-safe discount: ${formatPercent(targetSafeDiscount, 2)}`,
      `Free-shipping price preserving ${targetMarginPercent}% margin: ${shippingComparison.preserveMarginPrice === null ? 'Unavailable' : formatMoney(shippingComparison.preserveMarginPrice)}`,
      `Fee profile: ${result.feeConfiguration.version} (${result.feeConfiguration.region}, ${result.feeConfiguration.currency})`,
      ...result.issues.map((issue) => `${issue.severity === 'blocking' ? 'Required' : 'Warning'}: ${issue.message}`),
    ].join('\n');
    await navigator.clipboard.writeText(summary);
    setNotice('Decision summary copied.');
    window.setTimeout(() => setNotice(''), 2200);
  };

  const expressProfitPackInterest = () => {
    trackEvent('profit_pack_interest', { marketplace: input.marketplace });
    setProfitPackInterest(true);
  };

  const loss = result.profit < 0;
  const ebayPlan = input.settings.ebaySellerPlan === 'unselected'
    ? undefined
    : getEbaySellerPlanRule(feeSchedule, input.settings.ebaySellerPlan);
  const ebayCategories = input.settings.ebaySellerPlan === 'unselected'
    ? undefined
    : getEbayCategories(feeSchedule, input.settings.ebaySellerPlan);
  const ebayInsertionFee =
    input.settings.ebaySellerPlan === 'unselected'
    || input.settings.ebayCategory === 'unselected'
    || input.settings.ebayCategory === 'unsupported'
      ? undefined
      : getEbayInsertionFee(
          feeSchedule,
          input.settings.ebaySellerPlan,
          input.settings.ebayCategory,
        );
  const itemizedFeeTotal = result.fees.reduce((sum, fee) => sum + fee.amount, 0);
  const maxFlowAmount = Math.max(result.revenue, result.totalCosts, 1);
  const flowRows = [
    { id: 'revenue', label: 'Sale revenue', amount: result.revenue, type: 'positive' },
    { id: 'fees', label: 'Marketplace fees', amount: result.marketplaceFees, type: 'cost' },
    ...result.costs
      .filter((cost) => cost.amount > 0)
      .map((cost) => ({ ...cost, type: 'cost' })),
    { id: 'profit', label: 'What you keep', amount: result.profit, type: loss ? 'loss' : 'profit' },
  ];
  const feeMarketplace = input.marketplace === 'etsy' || input.marketplace === 'ebay'
    ? input.marketplace
    : null;
  const feeSourceStatus = feeMarketplace ? result.feeConfiguration.sourceStatus : null;
  const feeSourceCheckedAt = feeMarketplace
    ? `${result.feeConfiguration.lastVerifiedDate}T00:00:00Z`
    : null;
  const decisionMarketplaceDetail = input.marketplace === 'ebay'
    ? `eBay · ${ebayPlan?.label ?? 'Store tier required'} · ${
        input.settings.ebayCategory !== 'unselected'
        && input.settings.ebayCategory !== 'unsupported'
        && ebayCategories
          ? ebayCategories[input.settings.ebayCategory].label
          : 'Category required'
      }`
    : MARKETPLACE_LABELS[input.marketplace];
  const feeSourceChecks = input.marketplace === 'ebay'
    ? [
        {
          label: 'eBay standard selling fee page',
          status: feeSchedule.sourceStatus.ebay,
          checkedAt: feeSchedule.sourceCheckedAt.ebay,
        },
        {
          label: 'eBay Store selling fee page',
          status: feeSchedule.sourceStatus.ebayStore,
          checkedAt: feeSchedule.sourceCheckedAt.ebayStore,
        },
      ]
    : input.marketplace === 'etsy'
      ? [{
          label: 'Etsy fee, payment, and Offsite Ads articles',
          status: feeSchedule.sourceStatus.etsy,
          checkedAt: feeSchedule.sourceCheckedAt.etsy,
        }]
      : [];
  const targetMarginBps = Math.round(targetMarginPercent * 100);
  const targetMet = result.status === 'ready'
    && result.revenue > 0
    && result.profit * 10_000 >= targetMarginBps * result.revenue;
  const targetMarginGapBps = result.marginBps === null
    ? null
    : Math.abs(result.marginBps - targetMarginBps);
  const targetMarginStatus = targetMarginGapBps === null
    ? 'Current margin unavailable'
    : targetMet
      ? targetMarginGapBps === 0
        ? 'Target met'
        : `Target met by ${formatPercent(targetMarginGapBps)}`
      : `${formatPercent(targetMarginGapBps)} below target`;
  const targetPriceDelta = marginPrice === null
    ? ''
    : marginPrice === input.sellingPrice
      ? 'matches current price'
      : marginPrice > input.sellingPrice
        ? `${formatMoney(marginPrice - input.sellingPrice)} above current price`
        : `${formatMoney(input.sellingPrice - marginPrice)} below current price`;
  const keepPerDollar = result.marginBps === null ? null : Math.round(result.marginBps / 100);

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="SellerMargin home">
          <span className="brand-mark" aria-hidden="true">SM</span>
          <span>SellerMargin</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#calculator">Calculator</a>
          <a href="#decision-tools">Decision tools</a>
          <button className="nav-button" type="button" onClick={() => setShowAssumptions(true)}>
            Fee details
          </button>
        </nav>
        <div className="header-actions">
          <span className="privacy-pill"><ShieldCheck size={15} /> No account required</span>
          <button className="button button-ghost button-small" type="button" onClick={() => setShowSaved((value) => !value)}>
            <PackageCheck size={16} /> Saved {saved.length > 0 && `(${saved.length})`}
          </button>
        </div>
      </header>

      {showSaved && (
        <section className="saved-drawer" aria-label="Saved products">
          <div>
            <span className="section-kicker">Saved on this device</span>
            <h2>Saved products</h2>
            <p>Your saved products are available only on this device.</p>
          </div>
          <div className="saved-list">
            {saved.length === 0 ? (
              <p className="empty-state">No saved products yet. Save the calculation you are working on.</p>
            ) : (
              saved.map((item) => (
                <div className="saved-item" key={item.id}>
                  <button type="button" onClick={() => { setInput(item.input); setShowSaved(false); }}>
                    <strong>{item.input.productName || 'Untitled product'}</strong>
                    <span>{MARKETPLACE_LABELS[item.input.marketplace]} · {formatMoney(item.input.sellingPrice)}</span>
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={`Delete ${item.input.productName || 'saved product'}`}
                    onClick={() => setSaved((current) => current.filter((savedItem) => savedItem.id !== item.id))}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><Sparkles size={15} /> {route.eyebrow}</div>
            <h1>{route.title}</h1>
            <p>{route.subtitle}</p>
            <div className="hero-actions">
              <a className="button button-primary" href="#calculator">Calculate my profit <ArrowDown size={17} /></a>
              <button className="button button-ghost" type="button" onClick={() => { setActiveTool('pricing'); trackEvent('decision_tool_selected', { marketplace: input.marketplace, tool: 'pricing' }); document.querySelector('#decision-tools')?.scrollIntoView({ behavior: 'smooth' }); }}>Find my price <Target size={17} /></button>
              <span><Check size={16} /> No signup</span>
              <span><Check size={16} /> USD</span>
              <span><Check size={16} /> Instant</span>
            </div>
          </div>
          <aside className="hero-proof" aria-label="SellerMargin product value">
            <span className="proof-number">Start here</span>
            <strong>{route.guideTitle}</strong>
            <ol className="quick-start-list">
              {route.guideItems.map((item) => (
                <li key={item.title}><b>{item.title}</b><span>{item.explanation}</span></li>
              ))}
            </ol>
          </aside>
        </section>

        <section className="calculator-shell" id="calculator" aria-label="Profit calculator" onChangeCapture={() => { calculatorInteracted.current = true; }}>
          <div className="input-panel">
            <div className="panel-heading">
              <div>
                <span className="section-kicker">Your sale</span>
                <h2>Tell us about one sale</h2>
              </div>
              <span className="live-badge"><span /> Updates instantly</span>
            </div>

            <div className={`fee-sync fee-sync-${feeSourceStatus ?? 'custom'}`}>
              <BadgeCheck size={18} />
              <div>
                <strong>
                  {feeLoadStatus === 'checking'
                    ? 'Checking official marketplace rates'
                    : feeMarketplace && feeSourceStatus === 'live'
                      ? `Official ${MARKETPLACE_LABELS[feeMarketplace]} rates checked`
                      : feeMarketplace && feeSourceStatus === 'review'
                        ? `${MARKETPLACE_LABELS[feeMarketplace]} source change needs review`
                      : feeMarketplace
                        ? `Latest verified ${MARKETPLACE_LABELS[feeMarketplace]} rates`
                        : input.marketplace === 'custom'
                          ? 'Your custom marketplace rates'
                          : 'No marketplace fee added'}
                </strong>
                <span>
                  {feeMarketplace && feeSourceCheckedAt
                    ? `${formatCheckedDate(feeSourceCheckedAt)} · ${result.feeConfiguration.region} · profile ${result.feeConfiguration.version}`
                    : input.marketplace === 'custom'
                      ? 'Enter the fees that apply to your selling channel.'
                      : 'Add payment processing under Other costs when needed.'}
                </span>
              </div>
              {feeMarketplace && (
                <button
                  type="button"
                  aria-label="Check marketplace fee sources again"
                  onClick={() => void refreshFeeSchedule()}
                  disabled={feeLoadStatus === 'checking'}
                >
                  <RefreshCw size={15} className={feeLoadStatus === 'checking' ? 'is-spinning' : ''} />
                  Check again
                </button>
              )}
            </div>

            <label className="field product-name-field" htmlFor="product-name">
              <span className="field-label">Product name <em>optional</em></span>
              <input
                id="product-name"
                value={input.productName}
                onChange={(event) => setInput((current) => ({ ...current, productName: event.target.value }))}
                placeholder="e.g. Hand-poured candle"
              />
            </label>

            <div className="form-grid primary-grid">
              <CurrencyInput
                id="selling-price"
                label="Selling price"
                value={input.sellingPrice}
                onChange={(value) => updateMoney('sellingPrice', value)}
                emphasized
              />
              <label className="field field-emphasized" htmlFor="marketplace">
                <span className="field-label">Marketplace</span>
                <select
                  id="marketplace"
                  value={input.marketplace}
                  onChange={(event) => {
                    const marketplace = event.target.value as MarketplaceId;
                    setInput((current) => ({ ...current, marketplace }));
                    completionTracked.current = false;
                    trackEvent('marketplace_selected', { marketplace });
                    if (marketplace === 'etsy' || marketplace === 'ebay') setShowMore(true);
                  }}
                >
                  {Object.entries(MARKETPLACE_LABELS).map(([id, label]) => <option value={id} key={id}>{label}</option>)}
                </select>
              </label>
              <CurrencyInput
                id="product-cost"
                label={input.marketplace === 'etsy' ? 'What it costs to make' : input.marketplace === 'ebay' ? 'What the item cost you' : 'What the item cost you'}
                value={input.productCost}
                onChange={(value) => updateMoney('productCost', value)}
                hint={input.marketplace === 'etsy' ? 'Materials plus any labor amount you want this sale to recover' : 'Your purchase or production cost for one item'}
              />
              <CurrencyInput
                id="seller-shipping"
                label="Shipping you pay"
                value={input.sellerShippingCost}
                onChange={(value) => updateMoney('sellerShippingCost', value)}
                hint="What the carrier charges you"
              />
            </div>

            <button className="more-toggle" type="button" onClick={() => setShowMore((value) => { const next = !value; if (next) trackEvent('advanced_costs_opened', { marketplace: input.marketplace }); return next; })} aria-expanded={showMore}>
              <span><span className="plus-mark">+</span> More costs and marketplace details</span>
              {showMore ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>

            {showMore && (
              <div className="advanced-fields">
                <div className="form-grid">
                  <CurrencyInput
                    id="customer-shipping"
                    label="Shipping paid by buyer"
                    value={input.customerShippingCharge}
                    onChange={(value) => updateMoney('customerShippingCharge', value)}
                    hint="Shipping amount added to the order"
                  />
                  <CurrencyInput
                    id="packaging"
                    label="Packaging"
                    value={input.packagingCost}
                    onChange={(value) => updateMoney('packagingCost', value)}
                  />
                  <CurrencyInput
                    id="advertising"
                    label="Other advertising"
                    value={input.advertisingCost}
                    onChange={(value) => updateMoney('advertisingCost', value)}
                  />
                  <CurrencyInput
                    id="other-costs"
                    label="Other variable costs"
                    value={input.otherCosts}
                    onChange={(value) => updateMoney('otherCosts', value)}
                  />
                  {(input.marketplace === 'etsy' || input.marketplace === 'ebay') && (
                    <CurrencyInput
                      id="marketplace-tax"
                      label="Sales tax collected by marketplace"
                      value={input.marketplaceCollectedTax}
                      onChange={(value) => updateMoney('marketplaceCollectedTax', value)}
                      hint="Used only when the marketplace includes tax in a fee calculation; not counted as your revenue"
                    />
                  )}
                </div>

                {(input.marketplace === 'etsy' || input.marketplace === 'ebay') && (
                  <label className="field compact-field" htmlFor="seller-region">
                    <span className="field-label">Where you sell from</span>
                    <select
                      id="seller-region"
                      value={input.settings.sellerRegion}
                      onChange={(event) => updateSetting('sellerRegion', event.target.value as TransactionInput['settings']['sellerRegion'])}
                    >
                      <option value="US">United States · USD (verified)</option>
                      <option value="OTHER">Another country (not yet supported)</option>
                    </select>
                    <small>Your country determines which marketplace rules apply.</small>
                  </label>
                )}

                {input.marketplace === 'etsy' && (
                  <div className="marketplace-options">
                    <div className="option-heading"><span className="marketplace-dot etsy-dot">E</span><strong>Etsy fee options</strong></div>
                    <label className="check-control">
                      <input
                        type="checkbox"
                        checked={input.settings.etsyIncludeListingFee}
                        onChange={(event) => updateSetting('etsyIncludeListingFee', event.target.checked)}
                      />
                      Include Etsy&apos;s {formatMoney(feeSchedule.etsy.listingFee)} listing fee in this sale
                    </label>
                    <label className="field compact-field" htmlFor="etsy-sale-source">
                      <span className="field-label">Was this order credited to an Etsy Offsite Ad?</span>
                      <select
                        id="etsy-sale-source"
                        value={input.settings.etsySaleSource}
                        onChange={(event) => updateSetting('etsySaleSource', event.target.value as TransactionInput['settings']['etsySaleSource'])}
                      >
                          <option value="organic">No - not credited to an Offsite Ad</option>
                          <option value="offsite">Yes - Etsy credited it to an Offsite Ad</option>
                      </select>
                    </label>
                    {input.settings.etsySaleSource === 'offsite' && (
                      <label className="field compact-field" htmlFor="etsy-offsite-tier">
                        <span className="field-label">Your Etsy Offsite Ads rate</span>
                        <select
                          id="etsy-offsite-tier"
                          value={input.settings.etsyOffsiteAdsTier}
                          onChange={(event) => updateSetting('etsyOffsiteAdsTier', event.target.value as TransactionInput['settings']['etsyOffsiteAdsTier'])}
                        >
                          <option value="unselected">Choose the tier from your shop status</option>
                          <option value="standard">Under $10,000 in the past 365 days · {feeSchedule.etsy.offsiteAdsStandardRateBps / 100}%</option>
                          <option value="reduced">At least $10,000 in the past 365 days · {feeSchedule.etsy.offsiteAdsReducedRateBps / 100}%</option>
                        </select>
                      </label>
                    )}
                  </div>
                )}

                {input.marketplace === 'ebay' && (
                  <div className="marketplace-options">
                    <div className="option-heading"><span className="marketplace-dot ebay-dot">e</span><strong>eBay fee options</strong></div>
                    <label className="field compact-field" htmlFor="ebay-plan">
                        <span className="field-label">eBay Store plan</span>
                      <select
                        id="ebay-plan"
                        value={input.settings.ebaySellerPlan}
                        onChange={(event) => setInput((current) => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            ebaySellerPlan: event.target.value as TransactionInput['settings']['ebaySellerPlan'],
                            ebayCategory: 'unselected',
                          },
                        }))}
                      >
                        <option value="unselected">Choose Store tier or No Store</option>
                        {Object.values(feeSchedule.ebay.sellerPlans).map((plan) => <option value={plan.id} key={plan.id}>{plan.label}</option>)}
                      </select>
                    </label>
                    <label className="field compact-field" htmlFor="ebay-category">
                        <span className="field-label">eBay category fee group</span>
                      <select
                        id="ebay-category"
                        value={input.settings.ebayCategory}
                        onChange={(event) => updateSetting('ebayCategory', event.target.value as TransactionInput['settings']['ebayCategory'])}
                      >
                        <option value="unselected">Choose the exact fee group</option>
                        {ebayCategories && Object.values(ebayCategories).map((category) => <option value={category.id} key={category.id}>{category.label}</option>)}
                        <option value="unsupported">My category is not listed</option>
                      </select>
                    </label>
                    <label className="field compact-field" htmlFor="ebay-status">
                        <span className="field-label">Seller status shown in your eBay dashboard</span>
                      <select id="ebay-status" value={input.settings.ebaySellerStatus} onChange={(event) => updateSetting('ebaySellerStatus', event.target.value as TransactionInput['settings']['ebaySellerStatus'])}>
                        <option value="unselected">Choose the status that applies</option>
                        <option value="meeting">Above Standard / Top Rated or no surcharge</option>
                        <option value="below-standard">Below Standard · +6%</option>
                        <option value="below-standard-long-term">Below Standard 4+ months · +7%</option>
                        <option value="very-high-inad">Very High item-not-as-described · +5%</option>
                        <option value="very-high-inad-long-term">Very High 4+ months · +6%</option>
                      </select>
                      <small>If both Below Standard and Very High apply, choose the Below Standard status; eBay applies only that surcharge.</small>
                    </label>
                    <label className="field compact-field" htmlFor="ebay-sale-source">
                        <span className="field-label">Was this order credited to a Promoted Listing?</span>
                      <select id="ebay-sale-source" value={input.settings.ebaySaleSource} onChange={(event) => updateSetting('ebaySaleSource', event.target.value as TransactionInput['settings']['ebaySaleSource'])}>
                        <option value="organic">No - not credited to an ad</option>
                        <option value="promoted">Yes - credited to Promoted Listings General</option>
                      </select>
                    </label>
                    {input.settings.ebaySaleSource === 'promoted' && (
                      <label className="field compact-field" htmlFor="ebay-promoted">
                        <span className="field-label">Ad rate shown for that campaign</span>
                        <span className="suffix-control">
                          <input
                            id="ebay-promoted"
                            type="number"
                            min="2"
                            max="100"
                            step="0.1"
                            value={input.settings.ebayPromotedListingRateBps / 100}
                            onChange={(event) => updateSetting('ebayPromotedListingRateBps', Math.round(Number(event.target.value) * 100))}
                          />
                          <span>%</span>
                        </span>
                      </label>
                    )}
                    <label className="check-control">
                      <input
                        type="checkbox"
                        checked={input.settings.ebayIncludeInsertionFee && (ebayInsertionFee ?? 0) > 0}
                        onChange={(event) => updateSetting('ebayIncludeInsertionFee', event.target.checked)}
                        disabled={ebayInsertionFee === undefined || ebayInsertionFee === 0}
                      />
                      {ebayInsertionFee === undefined
                        ? 'Choose a plan and category to determine insertion fees'
                        : ebayInsertionFee === 0
                        ? 'No insertion fee for this category'
                        : `Fixed-price free-listing allowance used (${formatMoney(ebayInsertionFee)})`}
                    </label>
                    <p className="marketplace-option-note">{ebayPlan?.label ?? 'No fee profile selected'}. Monthly Store subscription and optional listing upgrades are not assigned to this sale.</p>
                  </div>
                )}

                {input.marketplace === 'custom' && (
                  <div className="marketplace-options custom-options">
                    <div className="option-heading"><span className="marketplace-dot custom-dot">%</span><strong>Custom fee options</strong></div>
                    <label className="field compact-field" htmlFor="custom-rate">
                      <span className="field-label">Platform percentage</span>
                      <span className="suffix-control">
                        <input
                          id="custom-rate"
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={input.settings.customPercentageRateBps / 100}
                          onChange={(event) => updateSetting('customPercentageRateBps', Math.round(Number(event.target.value) * 100))}
                        />
                        <span>%</span>
                      </span>
                    </label>
                    <CurrencyInput id="custom-fixed" label="Fixed fee" value={input.settings.customFixedFee} onChange={(value) => updateSetting('customFixedFee', value)} />
                    <CurrencyInput id="custom-listing" label="Listing fee" value={input.settings.customListingFee} onChange={(value) => updateSetting('customListingFee', value)} />
                  </div>
                )}
              </div>
            )}

            <div className="input-footer">
              <span><ShieldCheck size={16} /> Your pricing data stays on your device.</span>
              <button type="button" className="text-button" onClick={() => setShowAssumptions(true)}>View assumptions</button>
            </div>
          </div>

          <div className="results-panel" aria-live="polite">
            <div className="results-topline">
              <span className="section-kicker">What you keep</span>
              <div className="result-actions">
                <button className="icon-label-button" type="button" onClick={saveCalculation}><Save size={16} /> Save</button>
                <button className="icon-label-button" type="button" onClick={() => void copyCalculation()}><Copy size={16} /> Copy math</button>
                <button className="icon-label-button" type="button" onClick={() => void copyDecisionSummary()}><Target size={16} /> Copy decision</button>
              </div>
            </div>

            {result.status === 'blocked' ? (
              <div className="blocked-result">
                <Info size={30} />
                <h2>Answer the marketplace questions</h2>
                <p>These details change the fee. SellerMargin asks instead of guessing and giving you the wrong total.</p>
                <ul>{result.issues.filter((issue) => issue.severity === 'blocking').map((issue) => <li key={issue.code}>{issue.message}</li>)}</ul>
                <button className="button button-primary" type="button" onClick={() => setShowMore(true)}>Choose fee details</button>
              </div>
            ) : input.sellingPrice === 0 && input.discountBps === 0 && input.customerShippingCharge === 0 ? (
              <div className="empty-result">
                <Calculator size={30} />
                <h2>Enter a selling price</h2>
                <p>Your profit and margin will appear here instantly.</p>
              </div>
            ) : (
              <>
                <div className={`profit-hero ${loss ? 'profit-hero-loss' : ''}`}>
                  <span>{loss ? "You're losing" : 'You keep'}</span>
                  <strong>{formatMoney(Math.abs(result.profit))}</strong>
                  <div className="profit-meta">
                    <span>per sale</span>
                    <span className={loss ? 'status-negative' : 'status-positive'}>
                      {loss ? 'Negative profit' : `${formatPercent(result.marginBps)} profit margin`}
                    </span>
                  </div>
                </div>

                {!loss && keepPerDollar !== null && (
                  <p className="plain-language-profit">
                    You keep about <strong>{keepPerDollar}¢ of every $1</strong> from this sale after the fees and costs you entered.
                  </p>
                )}

                <div className="target-price-strip">
                  <label htmlFor="main-target-margin">
                    <span>Profit margin goal <small>The share of each sale you want to keep</small></span>
                    <span className="suffix-control"><input id="main-target-margin" type="number" min="0" max="99" value={targetMarginPercent} onChange={(event) => setTargetMarginPercent(Math.min(99, Math.max(0, Number(event.target.value) || 0)))} /><span>%</span></span>
                  </label>
                  <div>
                    <span>Price needed for that goal</span>
                    <strong>{marginPrice === null ? 'Unavailable' : formatMoney(marginPrice)}</strong>
                    {marginPrice !== null && <small>{targetMarginStatus} · {targetPriceDelta} · before discounts</small>}
                  </div>
                  {marginPrice !== null && marginPrice !== input.sellingPrice && <button className="button button-ghost button-small" type="button" onClick={() => setInput((current) => ({ ...current, sellingPrice: marginPrice, discountBps: 0 }))}>Use this price</button>}
                </div>

                {result.issues.some((issue) => issue.severity === 'warning') && (
                  <div className="calculation-warnings">
                    {result.issues.filter((issue) => issue.severity === 'warning').map((issue) => <p key={issue.code}><Info size={15} /> {issue.message}</p>)}
                  </div>
                )}

                <div className="metric-list">
                  <Metric label="Customer pays" value={formatMoney(result.revenue)} />
                  <Metric label="Marketplace fees" value={`−${formatMoney(result.marketplaceFees)}`} />
                  <Metric label="Your product and delivery costs" value={`−${formatMoney(result.variableCosts)}`} />
                  <Metric label="You keep after these costs" value={formatMoney(result.profit)} tone={loss ? 'negative' : 'positive'} />
                </div>

                <div className="money-flow">
                  <div className="subheading-row">
                    <div>
                      <span className="section-kicker">Money flow</span>
                      <h3>Where the sale goes</h3>
                    </div>
                    <ReceiptText size={20} />
                  </div>
                  <div className="flow-chart">
                    {flowRows.map((row) => {
                      const width = Math.max(4, Math.min(100, (Math.abs(row.amount) / maxFlowAmount) * 100));
                      return (
                        <div className={`flow-row flow-${row.type}`} key={row.id}>
                          <div className="flow-label"><span>{row.label}</span><strong>{formatMoney(row.amount)}</strong></div>
                          <div className="flow-track"><span style={{ '--flow-width': `${width}%` } as CSSProperties} /></div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <section className="fee-breakdown" aria-labelledby="fee-breakdown-title">
                  <div className="fee-breakdown-heading">
                    <span id="fee-breakdown-title"><ReceiptText size={17} /> Marketplace fee breakdown</span>
                    <strong>{formatMoney(result.marketplaceFees)}</strong>
                  </div>
                  <p className="fee-basis-note">Every row below is included in the total above. A percentage formula shows the amount the marketplace uses as its fee base.</p>
                  <div className="fee-lines">
                    {result.fees.length === 0 ? (
                      <p>No platform fees are assumed for a direct sale.</p>
                    ) : (
                      result.fees.map((fee) => (
                        <div className="fee-line" key={fee.id}>
                          <div>
                            <strong>{fee.label}</strong>
                            <code className="fee-formula">{fee.calculation}</code>
                            <small>{fee.explanation}</small>
                            <small>Rounding: {fee.rounding}</small>
                          </div>
                          <span>{formatMoney(fee.amount)}</span>
                        </div>
                      ))
                    )}
                    <div className="fee-line fee-total-line">
                      <div><strong>Marketplace fee total</strong><small>Sum of the itemized fee rows.</small></div>
                      <span>{formatMoney(itemizedFeeTotal)}</span>
                    </div>
                  </div>
                </section>
              </>
            )}
            <p className="result-disclaimer"><Info size={14} /> This is profit for one sale before business overhead and income tax. It does not replace accounting or tax records.</p>
          </div>
        </section>

        <div className="toast" role="status" aria-live="polite" data-visible={Boolean(notice)}>
          <Check size={16} /> {notice}
        </div>

        <section className="decision-tools" id="decision-tools">
          <div className="section-intro">
            <span className="section-kicker">Try your next question</span>
            <h2>See what changes before you change the price.</h2>
            <p>These tools reuse the sale and costs above, so every answer comes from the same calculation.</p>
          </div>
          <div className="tool-tabs" role="tablist" aria-label="Decision tools">
            {DECISION_TOOLS.map(([id, Icon, label]) => (
              <button
                id={`decision-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={activeTool === id}
                aria-controls={`decision-panel-${id}`}
                tabIndex={activeTool === id ? 0 : -1}
                className={activeTool === id ? 'active' : ''}
                onClick={() => { setActiveTool(id); trackEvent('decision_tool_selected', { marketplace: input.marketplace, tool: id }); }}
                onKeyDown={(event) => {
                  const currentIndex = DECISION_TOOLS.findIndex(([toolId]) => toolId === id);
                  const lastIndex = DECISION_TOOLS.length - 1;
                  const nextIndex = event.key === 'ArrowRight'
                    ? (currentIndex + 1) % DECISION_TOOLS.length
                    : event.key === 'ArrowLeft'
                      ? (currentIndex - 1 + DECISION_TOOLS.length) % DECISION_TOOLS.length
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? lastIndex
                          : null;
                  if (nextIndex === null) return;
                  event.preventDefault();
                  const nextId = DECISION_TOOLS[nextIndex][0];
                  setActiveTool(nextId);
                  window.requestAnimationFrame(() => document.getElementById(`decision-tab-${nextId}`)?.focus());
                }}
                key={id}
              >
                <Icon size={18} /> {label}
              </button>
            ))}
          </div>

          <div className="tool-workspace">
            <div className="decision-source">
              <div className="decision-source-heading">
                <span><ReceiptText size={16} /> Inputs reused from the fee calculator</span>
                <a href="#calculator">Edit inputs</a>
              </div>
              <div className="decision-input-grid">
                <div><span>Regular item price</span><strong>{formatMoney(input.sellingPrice)}</strong></div>
                <div><span>Marketplace</span><strong>{decisionMarketplaceDetail}</strong></div>
                <div><span>Shipping charged</span><strong>{formatMoney(input.customerShippingCharge)}</strong></div>
                <div><span>Sales tax in fee base</span><strong>{input.marketplace === 'etsy' || input.marketplace === 'ebay' ? formatMoney(input.marketplaceCollectedTax) : 'Not used for this channel'}</strong></div>
                <div><span>Your entered costs</span><strong>{formatMoney(result.variableCosts)}</strong></div>
                <div>
                  <span>Fee-rate source</span>
                  <strong>
                    {feeMarketplace
                      ? `${feeSourceStatus === 'live' ? 'Official pages checked' : feeSourceStatus === 'review' ? 'Pinned profile · source review needed' : 'Verified snapshot'} · ${result.feeConfiguration.lastVerifiedDate}`
                      : input.marketplace === 'custom'
                        ? 'Your custom rates'
                        : 'No marketplace fee'}
                  </strong>
                </div>
              </div>
            </div>
            {result.status === 'blocked' && (
              <div id={`decision-panel-${activeTool}`} role="tabpanel" aria-labelledby={`decision-tab-${activeTool}`} className="cannot-calculate decision-blocked"><Info size={22} /><h4>Answer the marketplace questions first</h4><p>The answer depends on the marketplace details above. SellerMargin will not substitute a guessed fee.</p><a className="button button-primary" href="#calculator" onClick={() => setShowMore(true)}>Choose fee details</a></div>
            )}
            {result.status === 'ready' && activeTool === 'pricing' && (
              <div id="decision-panel-pricing" role="tabpanel" aria-labelledby="decision-tab-pricing" className="tool-layout">
                <div className="tool-controls">
                  <span className="tool-icon"><Target size={22} /></span>
                  <h3>What should I charge?</h3>
                  <p>Choose what you want to keep. SellerMargin finds the lowest item price that reaches that goal before discounts.</p>
                  <label className="field" htmlFor="target-margin">
                    <span className="field-label">Profit margin goal</span>
                    <span className="suffix-control">
                      <input id="target-margin" type="number" min="0" max="99" step="1" value={targetMarginPercent} onChange={(event) => setTargetMarginPercent(Math.min(99, Math.max(0, Number(event.target.value) || 0)))} />
                      <span>%</span>
                    </span>
                  </label>
                  <CurrencyInput id="target-profit" label="Dollar profit goal per item" value={targetProfit} onChange={setTargetProfit} hint="How many dollars you want left after the entered fees and costs" />
                </div>
                <div className="tool-results pricing-results">
                  <div className="recommendation-card recommendation-primary">
                    <span>Price for {targetMarginPercent}% margin</span>
                    <strong>{marginPrice === null ? 'Not reachable' : formatMoney(marginPrice)}</strong>
                    {marginPriceResult && <p>{formatMoney(marginPriceResult.profit)} profit · {formatPercent(marginPriceResult.marginBps)} margin</p>}
                  </div>
                  <div className="recommendation-card">
                    <span>Price for {formatMoney(targetProfit)} profit</span>
                    <strong>{profitPrice === null ? 'Not reachable' : formatMoney(profitPrice)}</strong>
                    {profitPriceResult && <p>{formatPercent(profitPriceResult.marginBps)} margin at this price</p>}
                  </div>
                  <div className="recommendation-note"><Info size={16} /><p>These are mathematical minimums. A price change may affect demand, conversion, or how customers perceive the product.</p></div>
                  <MathTrail rows={[
                    {
                      label: 'Price source',
                      formula: 'Solved only from the fee-calculator inputs above',
                      note: 'No competitor, catalog, or market price is fetched.',
                    },
                    {
                      label: `${targetMarginPercent}% margin target`,
                      formula: marginPriceResult
                        ? `${formatMoney(marginPriceResult.profit)} profit ÷ ${formatMoney(marginPriceResult.revenue)} customer pays = ${formatPercent(marginPriceResult.marginBps)}`
                        : 'No matching whole-cent price found',
                      note: 'Returns the lowest whole-cent item price that reaches the target.',
                    },
                    {
                      label: `${formatMoney(targetProfit)} profit target`,
                      formula: profitPriceResult
                        ? `${formatMoney(profitPriceResult.revenue)} − ${formatMoney(profitPriceResult.marketplaceFees)} fees − ${formatMoney(profitPriceResult.variableCosts)} entered costs = ${formatMoney(profitPriceResult.profit)}`
                        : 'No matching whole-cent price found',
                      note: 'Marketplace fees are recalculated at every candidate price.',
                    },
                    {
                      label: 'Discount handling',
                      formula: 'Target prices are calculated before discounts',
                      note: `The calculator's current ${input.discountBps / 100}% discount is not applied to these two target prices.`,
                    },
                  ]} />
                </div>
              </div>
            )}

            {result.status === 'ready' && activeTool === 'discount' && (
              <div id="decision-panel-discount" role="tabpanel" aria-labelledby="decision-tab-discount" className="tool-layout">
                <div className="tool-controls">
                  <span className="tool-icon"><BarChart3 size={22} /></span>
                  <h3>Can I afford this sale discount?</h3>
                  <p>Compare regular-price profit with the sale price and see when the discount breaks your goal.</p>
                  <label className="field" htmlFor="discount-rate">
                    <span className="field-label">Sale discount</span>
                    <span className="suffix-control">
                      <input id="discount-rate" type="number" min="0" max="100" step="0.01" value={input.discountBps / 100} onChange={(event) => setInput((current) => ({ ...current, discountBps: clampBasisPoints(Number(event.target.value) * 100) }))} />
                      <span>%</span>
                    </span>
                  </label>
                  <div className="quick-options">
                    {[10, 15, 20, 25].map((value) => <button type="button" key={value} onClick={() => setInput((current) => ({ ...current, discountBps: value * 100 }))}>{value}%</button>)}
                  </div>
                </div>
                <div className="tool-results">
                  <div className="scenario-grid two-up">
                    <ScenarioCard eyebrow="Regular price" title={formatMoney(input.sellingPrice)} result={discountComparison.regular} highlighted />
                    <ScenarioCard eyebrow={`${input.discountBps / 100}% sale`} title={formatMoney(discountComparison.discounted.itemRevenue)} result={discountComparison.discounted} />
                  </div>
                  <div className="insight-banner">
                    <div><span>Profit reduction</span><strong>{formatMoney(discountComparison.profitReduction)}</strong></div>
                    <div><span>Extra sales needed</span><strong>{discountComparison.requiredSalesIncreasePercent === null ? 'Not recoverable' : `${Math.ceil(discountComparison.requiredSalesIncreasePercent)}%`}</strong></div>
                    <div><span>Break-even discount</span><strong>{formatPercent(breakEvenDiscount, 2)}</strong></div>
                    <div><span>{targetMarginPercent}% margin-safe discount</span><strong>{formatPercent(targetSafeDiscount, 2)}</strong></div>
                  </div>
                  {targetSafeDiscount !== null && input.discountBps > targetSafeDiscount && <div className="recommendation-note warning-note"><Info size={16} /><p>This sale exceeds the {formatPercent(targetSafeDiscount, 2)} maximum discount that preserves your {targetMarginPercent}% target. The displayed margin is rounded; the exact whole-cent calculation is below target.</p></div>}
                  <MathTrail rows={[
                    {
                      label: 'Sale item price',
                      formula: `${formatMoney(input.sellingPrice)} × (1 − ${input.discountBps / 100}%) = ${formatMoney(discountComparison.discounted.itemRevenue)}`,
                      note: `The ${formatMoney(input.customerShippingCharge)} shipping charge is then added to customer revenue.`,
                    },
                    {
                      label: 'Regular profit',
                      formula: `${formatMoney(discountComparison.regular.revenue)} − ${formatMoney(discountComparison.regular.marketplaceFees)} fees − ${formatMoney(discountComparison.regular.variableCosts)} entered costs = ${formatMoney(discountComparison.regular.profit)}`,
                    },
                    {
                      label: 'Sale profit',
                      formula: `${formatMoney(discountComparison.discounted.revenue)} − ${formatMoney(discountComparison.discounted.marketplaceFees)} fees − ${formatMoney(discountComparison.discounted.variableCosts)} entered costs = ${formatMoney(discountComparison.discounted.profit)}`,
                      note: 'Percentage fees are recalculated on the lower sale amount; fixed fees and entered costs remain.',
                    },
                    {
                      label: 'Extra sales needed',
                      formula: discountComparison.requiredSalesIncreasePercent === null
                        ? 'Cannot recover the regular profit with a non-positive sale profit'
                        : `(${formatMoney(discountComparison.regular.profit)} ÷ ${formatMoney(discountComparison.discounted.profit)} − 1) × 100 = ${discountComparison.requiredSalesIncreasePercent.toFixed(1)}%`,
                      note: discountComparison.requiredSalesIncreasePercent === null ? undefined : `Displayed as ${Math.ceil(discountComparison.requiredSalesIncreasePercent)}% after rounding up.`,
                    },
                    {
                      label: 'Break-even discount',
                      formula: `${formatPercent(breakEvenDiscount, 2)} is the highest 0.01% step where profit is at least $0.00`,
                    },
                    {
                      label: `${targetMarginPercent}% margin-safe discount`,
                      formula: `${formatPercent(targetSafeDiscount, 2)} is the highest 0.01% step where margin remains at least ${targetMarginPercent}%`,
                      note: 'Marketplace fees are recalculated at every candidate discount.',
                    },
                  ]} />
                </div>
              </div>
            )}

            {result.status === 'ready' && activeTool === 'shipping' && (
              <div id="decision-panel-shipping" role="tabpanel" aria-labelledby="decision-tab-shipping" className="tool-layout tool-layout-wide">
                <div className="tool-controls">
                  <span className="tool-icon"><Truck size={22} /></span>
                  <h3>Free shipping simulator</h3>
                  <p>Free shipping is a pricing strategy - fulfillment still has to be paid for.</p>
                  <CurrencyInput id="shipping-scenario-charge" label="Customer currently pays" value={input.customerShippingCharge} onChange={(value) => updateMoney('customerShippingCharge', value)} />
                  <CurrencyInput id="shipping-scenario-cost" label="Your shipping cost" value={input.sellerShippingCost} onChange={(value) => updateMoney('sellerShippingCost', value)} />
                </div>
                <div className="tool-results">
                  <div className="scenario-grid three-up">
                    <ScenarioCard eyebrow="Current" title="Customer-paid" result={shippingComparison.current} highlighted />
                    <ScenarioCard eyebrow="Option 1" title="Free, same price" result={shippingComparison.freeSamePrice} note={`${formatMoney(shippingComparison.current.profit - shippingComparison.freeSamePrice.profit)} less profit`} />
                    {shippingComparison.preserveMarginResult ? (
                      <ScenarioCard eyebrow="Option 2" title={`Preserve ${targetMarginPercent}% margin`} result={shippingComparison.preserveMarginResult} note={`Set item price to ${formatMoney(shippingComparison.preserveMarginPrice ?? 0)}`} />
                    ) : (
                      <article className="scenario-card"><span className="scenario-eyebrow">Option 2</span><h4>Preserve target margin</h4><div className="scenario-unavailable">Complete the fee profile to solve a price.</div></article>
                    )}
                  </div>
                  <MathTrail rows={[
                    {
                      label: 'Current transaction',
                      formula: `${formatMoney(shippingComparison.current.revenue)} − ${formatMoney(shippingComparison.current.marketplaceFees)} fees − ${formatMoney(shippingComparison.current.variableCosts)} entered costs = ${formatMoney(shippingComparison.current.profit)}`,
                    },
                    {
                      label: 'Free, same item price',
                      formula: `Shipping charged changes from ${formatMoney(input.customerShippingCharge)} to $0.00`,
                      note: `Your ${formatMoney(input.sellerShippingCost)} carrier cost stays in the calculation and marketplace fees are recalculated.`,
                    },
                    {
                      label: `Price that preserves ${targetMarginPercent}% margin`,
                      formula: shippingComparison.preserveMarginResult
                        ? `${formatMoney(shippingComparison.preserveMarginResult.profit)} profit ÷ ${formatMoney(shippingComparison.preserveMarginResult.revenue)} customer pays = ${formatPercent(shippingComparison.preserveMarginResult.marginBps)}`
                        : 'No price can be solved until all required fee inputs are supplied',
                      note: `The lowest whole-cent price is solved with shipping charged set to $0.00 and the current ${input.discountBps / 100}% discount retained.`,
                    },
                  ]} />
                </div>
              </div>
            )}

            {result.status === 'ready' && activeTool === 'ads' && (
              <div id="decision-panel-ads" role="tabpanel" aria-labelledby="decision-tab-ads" className="tool-layout">
                <div className="tool-controls">
                  <span className="tool-icon"><Megaphone size={22} /></span>
                  <h3>What does advertising do to this sale?</h3>
                  <p>Compare a sale without a marketplace-attributed ad fee with one credited to Etsy Offsite Ads or eBay Promoted Listings.</p>
                  {input.marketplace === 'etsy' && (
                    <label className="field" htmlFor="ads-etsy-tier"><span className="field-label">Offsite Ads shop-revenue tier</span><select id="ads-etsy-tier" value={input.settings.etsyOffsiteAdsTier} onChange={(event) => updateSetting('etsyOffsiteAdsTier', event.target.value as TransactionInput['settings']['etsyOffsiteAdsTier'])}><option value="unselected">Choose tier for comparison</option><option value="standard">Under $10,000 · {feeSchedule.etsy.offsiteAdsStandardRateBps / 100}%</option><option value="reduced">At least $10,000 · {feeSchedule.etsy.offsiteAdsReducedRateBps / 100}%</option></select></label>
                  )}
                  {input.marketplace === 'ebay' && (
                    <label className="field" htmlFor="ads-ebay-rate"><span className="field-label">General campaign ad rate</span><span className="suffix-control"><input id="ads-ebay-rate" type="number" min="2" max="100" step="0.1" value={input.settings.ebayPromotedListingRateBps / 100} onChange={(event) => updateSetting('ebayPromotedListingRateBps', Math.round(Number(event.target.value) * 100))} /><span>%</span></span></label>
                  )}
                  <CurrencyInput id="ads-other-cost" label="Other advertising cost per sale" value={input.advertisingCost} onChange={(value) => updateMoney('advertisingCost', value)} />
                </div>
                <div className="tool-results">
                  {saleSourceComparison && (
                    <>
                      <div className="scenario-grid two-up">
                        <ScenarioCard eyebrow="Organic" title="Not marketplace-ad attributed" result={saleSourceComparison.organic} highlighted />
                        <ScenarioCard eyebrow="Attributed" title={input.marketplace === 'etsy' ? 'Etsy Offsite Ads' : 'eBay Promoted Listings General'} result={saleSourceComparison.attributed} note={saleSourceComparison.attributed.status === 'ready' ? `${formatMoney(saleSourceComparison.profitReduction)} less profit` : undefined} />
                      </div>
                      {saleSourceComparison.attributed.status === 'ready' && <div className="insight-banner"><div><span>Additional marketplace ad fee</span><strong>{formatMoney(saleSourceComparison.marketplaceFeeIncrease)}</strong></div><div><span>Profit reduction</span><strong>{formatMoney(saleSourceComparison.profitReduction)}</strong></div></div>}
                    </>
                  )}
                  <div className="scenario-grid two-up">
                    <ScenarioCard eyebrow="Before other ads" title="$0 entered ad cost" result={advertisingComparison.beforeAdvertising} highlighted />
                    <ScenarioCard eyebrow="After other ads" title={`${formatMoney(input.advertisingCost)} per sale`} result={advertisingComparison.afterAdvertising} note={`${formatMoney(advertisingComparison.profitReduction)} less profit`} />
                  </div>
                  <MathTrail rows={[
                    { label: 'Marketplace attribution', formula: saleSourceComparison ? `Organic and attributed sales use the same price, shipping, tax, and costs; only the conditional marketplace ad fee changes` : 'No attributed marketplace ad program is assumed for this channel' },
                    { label: 'Other advertising', formula: `${formatMoney(advertisingComparison.beforeAdvertising.profit)} − ${formatMoney(input.advertisingCost)} = ${formatMoney(advertisingComparison.afterAdvertising.profit)}`, note: 'Enter only the advertising cost attributable to this sale.' },
                  ]} />
                </div>
              </div>
            )}

            {result.status === 'ready' && activeTool === 'goal' && (
              <div id="decision-panel-goal" role="tabpanel" aria-labelledby="decision-tab-goal" className="tool-layout">
                <div className="tool-controls">
                  <span className="tool-icon"><Calculator size={22} /></span>
                  <h3>How many sales reach my goal?</h3>
                  <p>Use the current profit per sale to estimate how many items you need to sell each month, week, and day.</p>
                  <CurrencyInput id="monthly-goal" label="Monthly profit target" value={monthlyTarget} onChange={setMonthlyTarget} />
                  <div className="current-profit-note">Using <strong>{formatMoney(result.profit)}</strong> profit per current sale</div>
                </div>
                <div className="tool-results goal-results">
                  {salesGoal.monthlyUnits === null ? (
                    <div className="cannot-calculate"><Info size={22} /><h4>A positive profit is required</h4><p>Adjust the transaction until each sale is profitable, then return here.</p></div>
                  ) : (
                    <>
                      <div className="goal-primary"><span>Sales needed</span><strong>{salesGoal.monthlyUnits}</strong><p>per month</p></div>
                      <ArrowRight className="goal-arrow" size={24} />
                      <div className="goal-secondary"><strong>{salesGoal.weeklyUnits}</strong><span>per week</span></div>
                      <div className="goal-secondary"><strong>{salesGoal.dailyUnits}</strong><span>per day</span></div>
                    </>
                  )}
                  <MathTrail rows={[
                    {
                      label: 'Current profit per sale',
                      formula: `${formatMoney(result.revenue)} − ${formatMoney(result.marketplaceFees)} fees − ${formatMoney(result.variableCosts)} entered costs = ${formatMoney(result.profit)}`,
                      note: `This includes the calculator's current ${input.discountBps / 100}% discount.`,
                    },
                    {
                      label: 'Monthly sales needed',
                      formula: result.profit > 0 && monthlyTarget > 0
                        ? `${formatMoney(monthlyTarget)} ÷ ${formatMoney(result.profit)} = ${(monthlyTarget / result.profit).toFixed(2)}, rounded up to ${salesGoal.monthlyUnits}`
                        : 'A positive monthly target and profit per sale are required',
                    },
                    {
                      label: 'Weekly and daily pace',
                      formula: salesGoal.monthlyUnits === null
                        ? 'Not available until profit is positive'
                        : `${salesGoal.monthlyUnits} ÷ 4.345 weeks = ${salesGoal.weeklyUnits}; ${salesGoal.monthlyUnits} ÷ 30.437 days = ${salesGoal.dailyUnits}`,
                      note: 'Each sales target is rounded up to a whole item.',
                    },
                  ]} />
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="profit-pack">
          <div className="pack-icon"><FileSpreadsheet size={27} /></div>
          <div>
            <span className="section-kicker">Seller Profit Pack · proposed $7 one-time tool</span>
            <h2>Would checking every product at once save you time?</h2>
            <p>We are measuring interest before building batch CSV analysis, margin flags, bulk target prices, and catalog exports.</p>
          </div>
          {profitPackInterest ? (
            <div className="interest-confirmation"><Check size={18} /><span><strong>Thanks - your interest was counted.</strong> No purchase was made and checkout is not live.</span></div>
          ) : (
            <button type="button" className="button button-accent" onClick={expressProfitPackInterest}>I&apos;d consider this for $7 <ArrowRight size={18} /></button>
          )}
        </section>

        <section className="trust-section">
          <div className="section-intro compact-intro">
            <span className="section-kicker">Made for everyday selling</span>
            <h2>Useful answers, with the details when you need them.</h2>
          </div>
          <div className="trust-grid">
            <article><RefreshCw size={22} /><h3>Marketplace rules are source-checked</h3><p>SellerMargin compares official Etsy and eBay pages with a reviewed, versioned fee profile and flags detected changes.</p></article>
            <article><ReceiptText size={22} /><h3>Every fee adds up in front of you</h3><p>See the percentage, amount it applies to, fixed charge, rounding, and individual fee total.</p></article>
            <article><ShieldCheck size={22} /><h3>No account or ChatGPT login</h3><p>Anyone can use the calculator. Your saved calculations remain in this browser.</p></article>
          </div>
        </section>
      </main>

      <footer>
        <a className="brand footer-brand" href="/"><span className="brand-mark" aria-hidden="true">SM</span><span>SellerMargin</span></a>
        <p>Know what you actually make. USD transaction estimates only.</p>
          <button className="text-button" type="button" onClick={() => setShowAssumptions(true)}>How fees are calculated</button>
      </footer>

      {showAssumptions && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowAssumptions(false); }}>
          <section ref={assumptionDialogRef} className="assumptions-modal" role="dialog" aria-modal="true" aria-labelledby="assumptions-title" aria-describedby="assumptions-description">
            <button className="modal-close" type="button" aria-label="Close fee assumptions" onClick={() => setShowAssumptions(false)}><X size={20} /></button>
            <span className="section-kicker">How the total is built</span>
            <h2 id="assumptions-title">{MARKETPLACE_LABELS[input.marketplace]} fee details</h2>
            <div className="verification-stamp"><BadgeCheck size={18} /><span><strong>{result.feeConfiguration.sourceStatus === 'live' ? 'Checked against official sources' : result.feeConfiguration.sourceStatus === 'review' ? 'Official source change needs review; pinned profile is active' : 'Using the reviewed fee profile'}</strong><small>Last verified {formatCheckedDate(`${result.feeConfiguration.lastVerifiedDate}T00:00:00Z`)} · {result.feeConfiguration.region} · {result.feeConfiguration.currency}</small></span></div>
            <div className="profile-metadata">
              <div><span>Configuration</span><strong>{result.feeConfiguration.version}</strong></div>
              <div><span>Effective date</span><strong>{result.feeConfiguration.effectiveDate}</strong></div>
              <div><span>Last verified</span><strong>{result.feeConfiguration.lastVerifiedDate}</strong></div>
              <div><span>Seller profile</span><strong>{result.feeConfiguration.region} · {result.feeConfiguration.currency}</strong></div>
            </div>
            {feeSourceChecks.length > 0 && (
              <div className="source-checks" aria-label="Official fee source checks">
                {feeSourceChecks.map((source) => (
                  <div key={source.label}>
                    <span>{source.label}</span>
                    <strong data-status={source.status}>
                      {source.status === 'live' ? 'Matches active profile' : source.status === 'review' ? 'Change detected · review needed' : 'Reviewed profile active'}
                    </strong>
                    <small>{formatCheckedDate(source.checkedAt)}</small>
                  </div>
                ))}
              </div>
            )}
            <p id="assumptions-description">{result.feeConfiguration.summary}</p>
            {result.feeConfiguration.conditions.length > 0 && <div className="active-conditions"><strong>Conditions used</strong><ul>{result.feeConfiguration.conditions.map((condition) => <li key={condition}>{condition}</li>)}</ul></div>}
            {result.issues.length > 0 && <div className="calculation-warnings">{result.issues.map((issue) => <p key={issue.code}><Info size={15} /> {issue.message}</p>)}</div>}
            <div className="assumption-lines">
              {result.fees.map((fee) => <div key={fee.id}><div><strong>{fee.label}</strong><code>{fee.calculation}</code><span>{fee.explanation}</span><span>Rounding: {fee.rounding}</span></div><b>{formatMoney(fee.amount)}</b></div>)}
              {result.fees.length === 0 && <p>No marketplace-specific fee formula is active.</p>}
            </div>
            {result.feeConfiguration.sources.length > 0 && (
              <div className="source-links">
                <span>Official sources</span>
                {result.feeConfiguration.sources.map((source) => (
                  <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>{source.label} <ExternalLink size={14} /></a>
                ))}
              </div>
            )}
            <div className="modal-note"><Info size={16} /><p>Rules vary by country, seller plan, category, performance, tax treatment, and optional services. Compare this estimate with your marketplace statement before making a material decision.</p></div>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
