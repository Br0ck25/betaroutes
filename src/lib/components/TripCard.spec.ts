/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import TripCard from '../../routes/dashboard/trips/components/TripCard.svelte';
import { mileage } from '$lib/stores/mileage';
import type { Trip } from '$lib/types';
import { mount } from 'svelte';

describe('TripCard component', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    // Ensure mileage store is empty to avoid background hydration effects
    void mileage.hydrate([]);
  });

  it('renders basic trip info (start, end, date, miles)', () => {
    const trip: Trip = {
      id: 't1',
      date: '2025-01-02',
      startAddress: '123 Main St, Town',
      endAddress: '456 Other Ave, City',
      totalMiles: 12.34,
      stops: [{ id: 's1', address: '456 Other Ave', earnings: 0 }]
    };

    mount(TripCard, { target: container, props: { trip } });

    // Start and End addresses rendered
    expect(container.textContent).toContain('123 Main St');
    expect(container.textContent).toContain('456 Other Ave');

    // Miles rendered in one of the stat values as 12.34
    expect(container.textContent).toContain('12.34');
  });

  it('handles missing data safely (no throws)', () => {
    const trip: Partial<Trip> = {
      id: 't2',
      // intentionally missing stops, notes, and hoursWorked
      startAddress: 'No Stops St'
    };

    expect(() =>
      mount(TripCard, { target: container, props: { trip: trip as unknown as Trip } })
    ).not.toThrow();
    // Should render start address and not crash
    expect(container.textContent).toContain('No Stops St');
  });

  it('calls window.open with Google Maps URL when map link is clicked', () => {
    const trip: Trip = {
      id: 't3',
      date: '2025-02-03',
      startAddress: 'A St',
      endAddress: 'B Ave',
      stops: []
    };

    const openSpy = vi
      .spyOn(window, 'open')
      .mockImplementation(() => null as unknown as Window | null);

    mount(TripCard, { target: container, props: { trip } });
    const mapBtn = container.querySelector('.map-link-btn') as HTMLButtonElement | null;
    expect(mapBtn).toBeTruthy();
    mapBtn!.click();

    expect(openSpy).toHaveBeenCalled();
    const calledUrl = String(openSpy.mock.calls[0]?.[0] ?? '');
    expect(calledUrl).toContain(encodeURIComponent(trip.startAddress || ''));
    expect(calledUrl).toContain(encodeURIComponent(trip.endAddress || trip.startAddress || ''));

    openSpy.mockRestore();
  });

  it('renders 50 instances without errors (performance smoke)', () => {
    const trips: Trip[] = [];
    for (let i = 0; i < 50; i++) {
      trips.push({
        id: `t-${i}`,
        startAddress: `S${i}`,
        endAddress: `E${i}`,
        date: '2025-01-01',
        totalMiles: i
      } as Trip);
    }

    for (const t of trips) {
      mount(TripCard, { target: container, props: { trip: t } });
    }

    const rendered = container.querySelectorAll('.trip-card-wrapper').length;
    expect(rendered).toBeGreaterThanOrEqual(50);
  });
});
