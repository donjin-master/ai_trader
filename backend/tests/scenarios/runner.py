"""
Test scenario runner. Called from command line.

Usage:
  python -m backend.tests.scenarios.runner --list
  python -m backend.tests.scenarios.runner --scenario s01
  python -m backend.tests.scenarios.runner --scenario all
  python -m backend.tests.scenarios.runner --scenario s05,s07
"""

import asyncio
import argparse
import json
from loguru import logger
from .s01_place_long          import PlaceLongScenario
from .s02_place_limit         import PlaceLimitScenario
from .s03_tp1_hit             import TP1HitScenario
from .s04_sl_hit              import SLHitScenario
from .s05_full_cycle          import FullCycleScenario
from .s06_kill_switch         import KillSwitchScenario
from .s07_telegram            import TelegramNotificationsScenario
from .s08_approval_flow       import ApprovalFlowScenario
from .s09_boardroom_force     import BoardroomForceScenario
from .s10_options_chain       import OptionsChainScenario
from .s11_iron_condor_strikes import IronCondorStrikesScenario
from .s12_iron_condor_place   import IronCondorPlaceScenario
from .s13_options_management  import OptionsManagementScenario
from .s14_regime_detector     import RegimeDetectorScenario
from .s15_event_driven        import EventDrivenScenario

SCENARIOS = {
    "s01": PlaceLongScenario,
    "s02": PlaceLimitScenario,
    "s03": TP1HitScenario,
    "s04": SLHitScenario,
    "s05": FullCycleScenario,
    "s06": KillSwitchScenario,
    "s07": TelegramNotificationsScenario,
    "s08": ApprovalFlowScenario,
    "s09": BoardroomForceScenario,
    "s10": OptionsChainScenario,
    "s11": IronCondorStrikesScenario,
    "s12": IronCondorPlaceScenario,
    "s13": OptionsManagementScenario,
    "s14": RegimeDetectorScenario,
    "s15": EventDrivenScenario,
}


async def run_scenario(key: str) -> dict:
    cls = SCENARIOS[key]
    scenario = cls()
    try:
        await scenario.setup()
        await scenario.run()
    except Exception as e:
        logger.error(f"Scenario {key} crashed: {e}", exc_info=True)
        scenario.check(False, f"Scenario crashed: {e}")
    finally:
        await scenario.teardown()
    return scenario.report()


async def main():
    parser = argparse.ArgumentParser(description="AI Trader Test Harness")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--scenario", type=str, default="s01")
    args = parser.parse_args()

    if args.list:
        print("\nAvailable scenarios:")
        for key, cls in SCENARIOS.items():
            print(f"  {key}: {cls.NAME}")
            print(f"       {cls.DESCRIPTION}")
        return

    keys = args.scenario.split(",") if args.scenario != "all" else list(SCENARIOS.keys())

    all_reports = []
    for key in keys:
        key = key.strip()
        if key not in SCENARIOS:
            logger.error(f"Unknown scenario: {key}. Use --list to see options.")
            continue
        logger.info(f"\n{'='*50}")
        report = await run_scenario(key)
        all_reports.append(report)

    # Final summary
    print("\n" + "="*50)
    print("FINAL RESULTS")
    print("="*50)
    for r in all_reports:
        icon = "✅" if r["overall"] == "PASS" else "❌"
        print(f"{icon} {r['scenario']}: {r['passed']}/{r['total']} passed")

    print("\nFull report:")
    print(json.dumps(all_reports, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
