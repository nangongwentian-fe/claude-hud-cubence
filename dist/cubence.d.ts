export interface CubenceData {
    balanceDollar: number;
    hasSubscription: boolean;
    fiveHourUsedDollar: number;
    fiveHourLimitDollar: number;
    weeklyUsedDollar: number;
    weeklyLimitDollar: number;
    latencyMs: number | null;
}
export declare function getCubenceBalance(): Promise<CubenceData | null>;
//# sourceMappingURL=cubence.d.ts.map