import { describe, it, expect } from 'vitest';
import { isValidIpfsCid, formatIpfsGatewayUrl } from '../utils/ipfs';
import { calculateDistanceKm } from '../utils/geolocation';
import { RedactionBox } from '../utils/anonymizer';
import { EVENT_TYPE_LABELS, formatGpsAccuracy, formatGpsCoordinates } from '../utils/signalLabels';

describe('Frontend Utils', () => {
  describe('IPFS Helper', () => {
    it('validates standard CIDv0 and CIDv1', () => {
      expect(isValidIpfsCid('QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco')).toBe(true);
      expect(isValidIpfsCid('bafybeicg2abbgahdnugn44gndst7k3t6enm7j3w65y6q5s66yvvdwtv3xu')).toBe(true);
      expect(isValidIpfsCid('')).toBe(false);
      expect(isValidIpfsCid('invalid-cid')).toBe(false);
    });

    it('formats IPFS gateway URLs correctly', () => {
      const cid = 'QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco';
      const gatewayUrl = formatIpfsGatewayUrl(cid);
      expect(gatewayUrl).toContain(cid);
      expect(gatewayUrl).toContain('/ipfs/');
    });
  });

  describe('Geolocation Helper', () => {
    it('computes distance between two coordinates accurately', () => {
      // Paris (48.8566, 2.3522) to Lyon (45.7640, 4.8357) ~ 392 km
      const distance = calculateDistanceKm(48.8566, 2.3522, 45.764, 4.8357);
      expect(distance).toBeGreaterThan(380);
      expect(distance).toBeLessThan(410);
    });

    it('returns zero distance for identical coordinates', () => {
      const distance = calculateDistanceKm(48.8566, 2.3522, 48.8566, 2.3522);
      expect(distance).toBe(0);
    });
  });

  describe('Anonymizer definitions', () => {
    it('supports RedactionBox structure', () => {
      const box: RedactionBox = {
        id: 'box_1',
        x: 10,
        y: 20,
        width: 100,
        height: 80,
      };
      expect(box.width).toBe(100);
      expect(box.height).toBe(80);
    });

    describe('Report location and context labels', () => {
      it('formats map coordinates to six decimal places', () => {
        expect(formatGpsCoordinates(48.8566123, 2.3522456)).toBe('48.856612, 2.352246');
      });

      it('reports device accuracy without claiming false meter precision', () => {
        expect(formatGpsAccuracy(4.7)).toBe('±5 m');
        expect(formatGpsAccuracy(0.3)).toBe('±<1 m');
        expect(formatGpsAccuracy(null)).toBeNull();
        expect(formatGpsAccuracy(0)).toBeNull();
      });

      it('provides a readable label for each collective-event type', () => {
        expect(EVENT_TYPE_LABELS.demonstration).toBe('Manifestation');
        expect(EVENT_TYPE_LABELS.strike).toBe('Grève');
      });
    });
  });
});
