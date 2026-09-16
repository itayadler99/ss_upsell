import React from 'react';
import { reactExtension } from '@shopify/ui-extensions-react/checkout';
import Offer from './Offer.jsx';

export default reactExtension('purchase.thank-you.block.render', () => <Offer />);
