"""The Maps check stores a readable first result when the state matches."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.maps_check import accept_result, field_query, is_named_example, maps_search_link, parse_first_maps_result

CLAY = "Clay County Regional Sports Complex"
MIDDLEBURG = (29.9994006, -81.8938394)
CLAY_BODY = """
)]}'
[["Clay County Regional Sports Complex, Middleburg, FL", [
  ["ignore", "this"],
  ["4790 Victory Ln", "Middleburg, FL 32068"],
  [null, null, 29.9994006, -81.8938394],
  [null, null, 27.32148, -80.40356]
]]]
"""
COPPELL_BODY = """
)]}'
[["Coppell Middle School North, Coppell, TX",
  [null, null, 32.9832707, -96.9912703],
  "Middle School North, 120 Natches Trce, Coppell, TX 75019",
  "Coppell, TX 75019"
]]
"""


class MapsCheckTests(unittest.TestCase):
    def test_query_matches_the_site_link(self) -> None:
        query = field_query(CLAY, "Middleburg", "FL")
        self.assertEqual(query, "Clay County Regional Sports Complex, Middleburg, FL")
        self.assertIn("query=Clay+County+Regional+Sports+Complex%2C+Middleburg%2C+FL", maps_search_link(query))

    def test_first_result_is_middleburg_not_a_later_point(self) -> None:
        place = parse_first_maps_result(CLAY_BODY)
        self.assertIsNotNone(place)
        assert place is not None
        self.assertEqual(place.city, "Middleburg")
        self.assertEqual(place.state, "FL")
        self.assertAlmostEqual(place.latitude, MIDDLEBURG[0])
        self.assertAlmostEqual(place.longitude, MIDDLEBURG[1])
        self.assertTrue(is_named_example(CLAY, "Middleburg", "FL"))

    def test_middleburg_result_is_saved_for_florida(self) -> None:
        place = parse_first_maps_result(CLAY_BODY)
        decision = accept_result("FL", place)
        self.assertTrue(decision.keep)
        self.assertEqual(decision.reason, "saved")

    def test_neighboring_city_is_saved_when_the_state_matches(self) -> None:
        body = ')]}\'\n[[["1 Stadium Dr", "Davie, FL 33314"], [null, null, 26.0765, -80.2521]]]'
        place = parse_first_maps_result(body)
        assert place is not None
        self.assertEqual(place.city, "Davie")
        decision = accept_result("FL", place)
        self.assertTrue(decision.keep)
        self.assertEqual(decision.reason, "saved")

    def test_other_state_is_not_saved(self) -> None:
        body = ')]}\'\n[[["1 Harbor Dr", "Port St. Lucie, GA 34952"], [null, null, 27.32148, -80.40356]]]'
        place = parse_first_maps_result(body)
        decision = accept_result("FL", place)
        self.assertFalse(decision.keep)
        self.assertEqual(decision.reason, "state-mismatch")

    def test_unreadable_result_is_left_blank(self) -> None:
        decision = accept_result("FL", parse_first_maps_result("<html></html>"))
        self.assertFalse(decision.keep)
        self.assertEqual(decision.reason, "no-result")

    def test_coppell_uses_the_city_line_and_the_first_point(self) -> None:
        place = parse_first_maps_result(COPPELL_BODY)
        self.assertIsNotNone(place)
        assert place is not None
        self.assertEqual(place.city, "Coppell")
        self.assertEqual(place.state, "TX")
        self.assertAlmostEqual(place.latitude, 32.9832707)
        self.assertAlmostEqual(place.longitude, -96.9912703)
        self.assertTrue(accept_result("TX", place).keep)


if __name__ == "__main__":
    unittest.main()
