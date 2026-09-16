import React, { useEffect, useState } from 'react';
import {
  useApi,
  BlockStack,
  InlineLayout,
  View,
  Image,
  Text,
  Heading,
  Button,
  Divider,
} from '@shopify/ui-extensions-react/checkout';

// Home-stock offer on the thank-you page.
//
// This is the only screen after payment that these stores actually get. The post-purchase
// page is shown by Shopify only when Shopify vaulted the card, and every order here goes
// through PayPlus - see api/px.js for the proof, and api/ty.js for why the offer links out
// to a fresh checkout instead of charging a card that does not exist.
//
// The block renders nothing at all unless the server returns a pair in the size on this
// order. An empty frame on a thank-you page reads as a broken store.

const API = 'https://ss-upsell.vercel.app';

function money(n) {
  return `${Math.round(Number(n))} ₪`;
}

export default function Offer() {
  const api = useApi();
  const [data, setData] = useState(null);

  useEffect(() => {
    let live = true;

    (async () => {
      try {
        const order =
          (api.orderConfirmation && api.orderConfirmation.current && api.orderConfirmation.current.order) ||
          (api.order && api.order.current) ||
          null;
        const orderId = order && order.id;
        if (!orderId) return;

        const token = await api.sessionToken.get();
        const res = await fetch(`${API}/api/ty`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, orderId }),
        });
        const body = await res.json();
        if (live && body && body.render) setData(body);
      } catch (e) {
        // A failure here must leave the thank-you page exactly as it was.
      }
    })();

    return () => {
      live = false;
    };
  }, []);

  // Fired from the block itself rather than inferred from a later order, because an
  // order tells us a pair was bought but never that this screen was the reason.
  function tap(act, item) {
    try {
      const q = new URLSearchParams({
        act,
        src: 'ty',
        shop: data.shop,
        size: String((item && item.displaySize) || data.boughtSize || ''),
        vid: String((item && item.id) || ''),
        n: String(data.items.length),
      });
      fetch(`${API}/api/tap?${q}`, { mode: 'no-cors', keepalive: true });
    } catch (e) {
      /* a beacon must never block the click it is measuring */
    }
  }

  useEffect(() => {
    if (data) tap('view', null);
  }, [data]);

  if (!data) return null;

  return (
    <BlockStack spacing="base" border="base" cornerRadius="base" padding="base">
      <Heading level={2}>יש לנו זוג נוסף במידה {data.boughtSize} שלך</Heading>
      <Text size="small" appearance="subdued">
        מלאי אחרון, זוג אחד מכל דגם. במחיר {money(data.items[0].price)} במקום המחיר המלא.
      </Text>
      {data.items.map((item, i) => (
        <BlockStack key={item.id} spacing="tight">
          {i > 0 ? <Divider /> : null}
          <InlineLayout columns={[70, 'fill', 'auto']} spacing="base" blockAlignment="center">
            <View>
              {item.image ? <Image source={item.image} border="base" cornerRadius="base" /> : null}
            </View>
            <BlockStack spacing="none">
              <Text size="small" emphasis="bold">
                {item.title}
              </Text>
              <Text size="small" appearance="subdued">
                מידה {item.displaySize}
                {item.halfUp ? ' (חצי מידה מעל)' : ''}
              </Text>
              <Text size="small" emphasis="bold">
                {money(item.price)}
                {item.compareAt > item.price ? `  במקום ${money(item.compareAt)}` : ''}
              </Text>
            </BlockStack>
            <Button kind="primary" to={item.url} onPress={() => tap('add', item)}>
              קחו אותו
            </Button>
          </InlineLayout>
        </BlockStack>
      ))}
      <Text size="extraSmall" appearance="subdued">
        ההזמנה שלכם כבר אושרה. הזוג הזה נשלח בהזמנה נפרדת.
      </Text>
    </BlockStack>
  );
}
