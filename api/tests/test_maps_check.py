"""The Maps check reads the first result for the site's own search query."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.maps_check import (
    compare_pin,
    field_query,
    is_named_example,
    maps_search_link,
    parse_first_maps_result,
)

CLAY = "Clay County Regional Sports Complex"
MIDDLEBURG = (29.9994006, -81.8938394)
PORT_ST_LUCIE = (27.2939, -80.3503)
CLAY_BODY = """
)]}'
[["Clay County Regional Sports Complex, Middleburg, FL", [
  ["ignore", "this"],
  ["4790 Victory Ln", "Middleburg, FL 32068"],
  [null, null, 29.9994006, -81.8938394],
  [null, null, 27.2939, -80.3503]
]]]
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

    def test_port_st_lucie_pin_is_not_kept(self) -> None:
        place = parse_first_maps_result(CLAY_BODY)
        comparison = compare_pin("Middleburg", "FL", PORT_ST_LUCIE[0], PORT_ST_LUCIE[1], place)
        self.assertFalse(comparison.keep)
        self.assertEqual(comparison.reason, "pin-other-place")
        self.assertTrue(is_named_example(CLAY, "Middleburg", "FL"))

    def test_pin_at_the_first_result_is_kept_and_not_called_verified(self) -> None:
        place = parse_first_maps_result(CLAY_BODY)
        comparison = compare_pin("Middleburg", "FL", MIDDLEBURG[0], MIDDLEBURG[1], place)
        self.assertTrue(comparison.keep)
        self.assertEqual(comparison.reason, "kept")

    def test_result_in_another_city_is_not_kept(self) -> None:
        body = ')]}\'\n[[["1 Harbor Dr", "Port St. Lucie, FL 34952"], [null, null, 27.2939, -80.3503]]]'
        place = parse_first_maps_result(body)
        comparison = compare_pin("Middleburg", "FL", PORT_ST_LUCIE[0], PORT_ST_LUCIE[1], place)
        self.assertFalse(comparison.keep)
        self.assertEqual(comparison.reason, "result-other-place")

    def test_unreadable_result_does_not_count_as_a_match(self) -> None:
        comparison = compare_pin("Middleburg", "FL", MIDDLEBURG[0], MIDDLEBURG[1], parse_first_maps_result("<html></html>"))
        self.assertFalse(comparison.keep)
        self.assertEqual(comparison.reason, "no-result")


if __name__ == "__main__":
    unittest.main()
