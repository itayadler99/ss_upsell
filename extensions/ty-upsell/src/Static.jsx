import React from 'react';
import { reactExtension } from '@shopify/ui-extensions-react/checkout';
import Offer from './Offer.jsx';

// Static target: renders without the merchant placing a block in the checkout editor.
export default reactExtension('purchase.thank-you.cart-line-list.render-after', () => <Offer />);
