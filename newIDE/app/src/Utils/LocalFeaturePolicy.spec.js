// @flow

import {
  LOCAL_FULL_FEATURES_ENABLED,
  canUseLocalFeature,
} from './LocalFeaturePolicy';

describe('LocalFeaturePolicy', () => {
  it('enables all local editor features in GDNG', () => {
    expect(LOCAL_FULL_FEATURES_ENABLED).toBe(true);
    expect(canUseLocalFeature(null)).toBe(true);
  });
});
