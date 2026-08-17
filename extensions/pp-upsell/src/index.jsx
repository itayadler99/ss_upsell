import React, { useState, useEffect, useMemo } from 'react';
import {
  extend,
  render,
  BlockStack,
  Button,
  CalloutBanner,
  Heading,
  Image,
  Layout,
  Select,
  Separator,
  Text,
  TextBlock,
  TextContainer,
  Tiles,
  View,
  useExtensionInput,
} from '@shopify/post-purchase-ui-extensions-react';

const API = 'https://ss-upsell.vercel.app';
const TIMER_SECONDS = 10 * 60;

extend('Checkout::PostPurchase::ShouldRender', async ({ inputData, storage }) => {
  // A backend hiccup must never break the customer's thank-you page.
  try {
    const res = await fetch(`${API}/api/offer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: inputData.token }),
    });
    const data = await res.json();
    if (!data.render) return { render: false };
    await storage.update(data.offer);
    return { render: true };
  } catch (e) {
    return { render: false };
  }
});

render('Checkout::PostPurchase::Render', () => <App />);

function money(n) {
  return `${Number(n).toFixed(2)} ₪`;
}

function useCountdown() {
  const [left, setLeft] = useState(TIMER_SECONDS);
  useEffect(() => {
    const id = setInterval(() => setLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, []);
  const clock = useMemo(() => {
    const m = String(Math.floor(left / 60)).padStart(2, '0');
    const s = String(left % 60).padStart(2, '0');
    return `${m}:${s}`;
  }, [left]);
  return { left, clock, expired: left <= 0 };
}

function Timer({ expired, clock }) {
  return (
    <View>
      <Text size="large" emphasized appearance={expired ? 'subdued' : 'critical'}>
        {expired ? 'ההצעה פגה' : `מהרו! ההצעה נסגרת בעוד ${clock}`}
      </Text>
    </View>
  );
}

function App() {
  const input = useExtensionInput();
  const offer = input.storage && input.storage.initialData;
  if (!offer) return null;
  if (offer.kind === 'homestock') {
    return offer.items && offer.items.length ? <HomeStock input={input} offer={offer} /> : null;
  }
  return offer.variants && offer.variants.length ? <SecondPair input={input} offer={offer} /> : null;
}

// The pairs kept at home. Priced flat, matched on size, posted by hand - so the
// pitch is scarcity of that exact size rather than a percentage off.
function HomeStock({ input, offer }) {
  const { inputData, applyChangeset, done } = input;
  const items = offer.items;

  const [firstId, setFirstId] = useState(items[0].id);
  const [secondId, setSecondId] = useState('none');
  const [busy, setBusy] = useState(false);
  const { clock, expired } = useCountdown();

  const first = items.find((i) => i.id === firstId) || items[0];
  const secondOptions = items.filter((i) => i.id !== firstId);
  const second = secondId === 'none' ? null : secondOptions.find((i) => i.id === secondId) || null;

  // Picking the same pair twice is impossible in the UI and rejected server-side,
  // but the second select still has to reset when the first one changes under it.
  useEffect(() => {
    if (secondId !== 'none' && !secondOptions.some((i) => i.id === secondId)) setSecondId('none');
  }, [firstId]);

  const pairs = second ? 2 : 1;
  const total = pairs === 2 ? offer.twoPairPrice : offer.onePairPrice;
  const listTotal = first.listPrice + (second ? second.listPrice : 0);

  async function accept() {
    setBusy(true);
    try {
      const stockIds = second ? [first.id, second.id] : [first.id];
      const res = await fetch(`${API}/api/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: inputData.token,
          referenceId: inputData.initialPurchase.referenceId,
          stockIds,
        }),
      });
      const { token } = await res.json();
      if (token) await applyChangeset(token);
    } finally {
      done();
    }
  }

  const banner = first.halfUp
    ? `נשאר לנו זוג אחד בחצי מידה מעל שלך (${first.variantTitle})`
    : `נשאר לנו זוג אחד במידה ${first.variantTitle}`;

  return (
    <BlockStack spacing="loose">
      <CalloutBanner title={`${banner} - במחיר חד פעמי`}>
        <Text>
          {first.halfUp
            ? 'חצי מידה מעל נועלים בלי בעיה. זה הזוג האחרון שנשאר במידה הזאת, במחיר שלא נחזור עליו.'
            : 'זה הזוג האחרון שנשאר במידה הזאת. ההצעה מופיעה פעם אחת בלבד ולא תחזור.'}
          {' אותו משלוח, בלי תוספת.'}
        </Text>
      </CalloutBanner>

      <Timer expired={expired} clock={clock} />

      <Layout
        media={[
          { viewportSize: 'small', sizes: [1, 0, 1] },
          { viewportSize: 'medium', sizes: [300, 30, 0.5] },
          { viewportSize: 'large', sizes: [400, 30, 0.5] },
        ]}
      >
        <View>{first.image ? <Image description={first.title} source={first.image} /> : null}</View>
        <View />
        <BlockStack spacing="xloose">
          <TextContainer>
            <Heading>{first.title}</Heading>
            <TextBlock subdued size="small">
              מידה {first.variantTitle}
            </TextBlock>
          </TextContainer>

          {items.length > 1 ? (
            <Select
              label="בחרו דגם"
              value={String(firstId)}
              onChange={(v) => setFirstId(v)}
              options={items.map((i) => ({
                label: `${i.title} · מידה ${i.variantTitle}`,
                value: String(i.id),
              }))}
            />
          ) : null}

          {offer.allowTwo && secondOptions.length ? (
            <Select
              label={`להוסיף זוג שני? שניים ב-${offer.twoPairPrice} ₪`}
              value={String(secondId)}
              onChange={(v) => setSecondId(v)}
              options={[{ label: 'בלי זוג שני', value: 'none' }].concat(
                secondOptions.map((i) => ({
                  label: `${i.title} · מידה ${i.variantTitle}`,
                  value: String(i.id),
                }))
              )}
            />
          ) : null}

          <Tiles>
            <Text role="deleted" size="medium" appearance="subdued">
              {money(listTotal)}
            </Text>
            <Text size="large" emphasized appearance="critical">
              {money(total)}
            </Text>
          </Tiles>

          <Separator />

          <Tiles>
            <TextBlock>{pairs === 2 ? 'שני זוגות' : 'זוג אחד'}</TextBlock>
            <TextBlock emphasized>{money(total)}</TextBlock>
          </Tiles>
          <Tiles>
            <TextBlock>משלוח</TextBlock>
            <TextBlock emphasized>חינם, נשלח עם ההזמנה הקיימת</TextBlock>
          </Tiles>
          <Tiles>
            <TextBlock emphasized>סה"כ לתשלום</TextBlock>
            <TextBlock emphasized>{money(total)}</TextBlock>
          </Tiles>

          <BlockStack>
            <Button submit onPress={accept} loading={busy} disabled={expired}>
              {expired ? 'ההצעה פגה' : `הוסיפו להזמנה • ${money(total)}`}
            </Button>
            <Button plain subdued onPress={done} disabled={busy}>
              לא תודה, ממשיך בלי
            </Button>
          </BlockStack>

          <TextBlock subdued size="small">
            התשלום מתבצע בכרטיס שכבר הזנתם. אין צורך למלא פרטים שוב.
          </TextBlock>
        </BlockStack>
      </Layout>
    </BlockStack>
  );
}

function SecondPair({ input, offer }) {
  const { inputData, applyChangeset, done } = input;
  const variants = offer.variants;

  const [variantId, setVariantId] = useState(String(offer.variantId));
  const [busy, setBusy] = useState(false);
  const { clock, expired } = useCountdown();

  const current = useMemo(
    () => variants.find((v) => String(v.id) === String(variantId)) || variants[0],
    [variantId, variants]
  );

  async function accept() {
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: inputData.token,
          referenceId: inputData.initialPurchase.referenceId,
          variantId,
        }),
      });
      const { token } = await res.json();
      if (token) await applyChangeset(token);
    } finally {
      done();
    }
  }

  const listPrice = current.price;
  // Priced from our own catalogue read, not from the changeset preview, so the
  // number on the button always matches the 35% the backend actually signs.
  const dealPrice = Math.round(listPrice * (100 - offer.discountPct)) / 100;

  return (
    <BlockStack spacing="loose">
      <CalloutBanner title={`רק עכשיו: זוג שני ב-${offer.discountPct}% הנחה`}>
        <Text>ההצעה הזאת מופיעה פעם אחת ולא תחזור. אותו משלוח, בלי תוספת תשלום.</Text>
      </CalloutBanner>

      <Timer expired={expired} clock={clock} />

      <Layout
        media={[
          { viewportSize: 'small', sizes: [1, 0, 1] },
          { viewportSize: 'medium', sizes: [300, 30, 0.5] },
          { viewportSize: 'large', sizes: [400, 30, 0.5] },
        ]}
      >
        <View>{offer.image ? <Image description={offer.productTitle} source={offer.image} /> : null}</View>
        <View />
        <BlockStack spacing="xloose">
          <TextContainer>
            <Heading>{offer.productTitle}</Heading>
          </TextContainer>

          <Select
            label="מידה"
            value={String(variantId)}
            onChange={(v) => setVariantId(v)}
            options={variants.map((v) => ({ label: v.title, value: String(v.id) }))}
          />

          <Tiles>
            <Text role="deleted" size="medium" appearance="subdued">
              {money(listPrice)}
            </Text>
            <Text size="large" emphasized appearance="critical">
              {money(dealPrice)}
            </Text>
          </Tiles>

          <Separator />

          <Tiles>
            <TextBlock>משלוח</TextBlock>
            <TextBlock emphasized>חינם, נשלח עם ההזמנה הקיימת</TextBlock>
          </Tiles>
          <Tiles>
            <TextBlock emphasized>סה"כ לתשלום</TextBlock>
            <TextBlock emphasized>{money(dealPrice)}</TextBlock>
          </Tiles>

          <BlockStack>
            <Button submit onPress={accept} loading={busy} disabled={expired}>
              {expired ? 'ההצעה פגה' : `הוסיפו להזמנה • ${money(dealPrice)}`}
            </Button>
            <Button plain subdued onPress={done} disabled={busy}>
              לא תודה, ממשיך בלי
            </Button>
          </BlockStack>

          <TextBlock subdued size="small">
            התשלום מתבצע בכרטיס שכבר הזנתם. אין צורך למלא פרטים שוב.
          </TextBlock>
        </BlockStack>
      </Layout>
    </BlockStack>
  );
}
