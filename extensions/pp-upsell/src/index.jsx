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

function App() {
  const input = useExtensionInput();
  const offer = input.storage && input.storage.initialData;
  if (!offer || !offer.variants || !offer.variants.length) return null;
  return <Offer input={input} offer={offer} />;
}

function Offer({ input, offer }) {
  const { inputData, applyChangeset, done } = input;
  const variants = offer.variants;

  const [variantId, setVariantId] = useState(String(offer.variantId));
  const [left, setLeft] = useState(TIMER_SECONDS);
  const [busy, setBusy] = useState(false);

  const current = useMemo(
    () => variants.find((v) => String(v.id) === String(variantId)) || variants[0],
    [variantId, variants]
  );

  useEffect(() => {
    const id = setInterval(() => setLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, []);

  const clock = useMemo(() => {
    const m = String(Math.floor(left / 60)).padStart(2, '0');
    const s = String(left % 60).padStart(2, '0');
    return `${m}:${s}`;
  }, [left]);

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
      await applyChangeset(token);
    } finally {
      done();
    }
  }

  const expired = left <= 0;
  const listPrice = current.price;
  // Priced from our own catalogue read, not from the changeset preview, so the
  // number on the button always matches the 35% the backend actually signs.
  const dealPrice = Math.round(listPrice * (100 - offer.discountPct)) / 100;

  return (
    <BlockStack spacing="loose">
      <CalloutBanner title={`רק עכשיו: זוג שני ב-${offer.discountPct}% הנחה`}>
        <Text>ההצעה הזאת מופיעה פעם אחת ולא תחזור. אותו משלוח, בלי תוספת תשלום.</Text>
      </CalloutBanner>

      <View>
        <Text size="large" emphasized appearance={expired ? 'subdued' : 'critical'}>
          {expired ? 'ההצעה פגה' : `מהרו! ההצעה נסגרת בעוד ${clock}`}
        </Text>
      </View>

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
