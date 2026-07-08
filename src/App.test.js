import { buildHistoricalCalibration, buildNrfiProbability, buildWeeklyPerformance, calibrateProbability, nrfiGrade } from './App';

describe('NRFI scoring', () => {
  it('raises the probability for a strong pitching and weak lineup setup', () => {
    const probability = buildNrfiProbability({
      homeERA: 3.60,
      awayERA: 3.80,
      homeRecentERA: 3.35,
      awayRecentERA: 3.55,
      homeOPS: 0.650,
      awayOPS: 0.680,
      pf: 0.95,
    });

    expect(probability).toBeGreaterThan(0.60);
  });

  it('lowers the probability for a weak pitching and hot lineup setup', () => {
    const probability = buildNrfiProbability({
      homeERA: 5.20,
      awayERA: 4.90,
      homeRecentERA: 5.10,
      awayRecentERA: 4.70,
      homeOPS: 0.820,
      awayOPS: 0.790,
      pf: 1.20,
    });

    expect(probability).toBeLessThan(0.40);
  });

  it('requires recent ERA data to reach grade A confidence', () => {
    const strongWithRecent = nrfiGrade({
      homeERA: 3.60,
      awayERA: 3.80,
      homeRecentERA: 3.35,
      awayRecentERA: 3.55,
      homeOPS: 0.650,
      awayOPS: 0.680,
      pf: 0.95,
    });

    const strongWithoutRecent = nrfiGrade({
      homeERA: 3.60,
      awayERA: 3.80,
      homeRecentERA: null,
      awayRecentERA: null,
      homeOPS: 0.650,
      awayOPS: 0.680,
      pf: 0.95,
    });

    expect(strongWithRecent.g).toBe('A');
    expect(strongWithoutRecent.g).toBe('B');
  });

  it('uses historical outcomes to pull a score toward the observed rate', () => {
    const calibration = buildHistoricalCalibration([
      { actualNRFI: true, homeERA: 3.50, awayERA: 3.80, homeRecentERA: 3.20, awayRecentERA: 3.40, homeOPS: 0.680, awayOPS: 0.690, parkFactor: 0.95 },
      { actualNRFI: false, homeERA: 3.50, awayERA: 3.80, homeRecentERA: 3.20, awayRecentERA: 3.40, homeOPS: 0.680, awayOPS: 0.690, parkFactor: 0.95 },
    ]);

    const raw = buildNrfiProbability({
      homeERA: 3.50,
      awayERA: 3.80,
      homeRecentERA: 3.20,
      awayRecentERA: 3.40,
      homeOPS: 0.680,
      awayOPS: 0.690,
      pf: 0.95,
    });

    const calibrated = calibrateProbability(raw, calibration);

    expect(calibrated).toBeGreaterThan(0.4);
    expect(calibrated).toBeLessThan(0.6);
  });

  it('groups records into weekly grade-specific NRFI performance', () => {
    const weekly = buildWeeklyPerformance([
      { date: '2026-07-01', actualNRFI: true, predictedGrade: 'A' },
      { date: '2026-07-02', actualNRFI: false, predictedGrade: 'A' },
      { date: '2026-07-03', actualNRFI: true, predictedGrade: 'B' },
      { date: '2026-07-08', actualNRFI: false, predictedGrade: 'A' },
    ]);

    expect(weekly).toHaveLength(2);
    expect(weekly[0].grades.A.rate).toBe(1 / 2);
    expect(weekly[0].grades.B.rate).toBe(1);
    expect(weekly[1].grades.A.rate).toBe(0);
    expect(weekly[1].grades.B.rate).toBeNull();
  });
});
