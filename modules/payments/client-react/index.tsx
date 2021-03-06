import ClientModule from '@module/module-client-react';

import stripe from './stripe';

export { default as StripeSubscriptionProfile } from './stripe/subscription/containers/SubscriptionProfile';

export default new ClientModule(stripe);
