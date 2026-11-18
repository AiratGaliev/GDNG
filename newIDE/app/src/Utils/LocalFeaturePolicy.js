// @flow

import {
  hasValidSubscriptionPlan,
  type Subscription,
} from './GDevelopServices/Usage';

/**
 * Enables local editor capabilities that are otherwise shown as Premium-only.
 *
 * This policy is deliberately separate from account subscription and server
 * limits: it must never grant cloud services, AI credits, or remote quotas.
 *
 * Set enabled to false to restore upstream subscription checks for local
 * editor capabilities without changing the user's account entitlement.
 */
const localFeaturePolicy: { enabled: boolean } = {
  enabled: true,
};

export const LOCAL_FULL_FEATURES_ENABLED: boolean = localFeaturePolicy.enabled;

export const canUseLocalFeature = (subscription: ?Subscription): boolean =>
  localFeaturePolicy.enabled || hasValidSubscriptionPlan(subscription);
