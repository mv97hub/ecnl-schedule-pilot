"""Hotel and restaurant lookup. The Geoapify key stays out of responses."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.database import engine, ensure_location_columns
from app.locations import make_venue_key
from app.main import app
from app.models import Base, LocationWriteEvent, VenueFieldPoint, VenueRecommendation
from app.places import NEAR_MILES, SEARCH_RADIUS_METERS, category_fits, miles_between, reset_place_rate_limit, suggest_places

SECRET = "probe-place-secret"
KEY = "super-secret-geoapify-key"
CITY = "Probeplace"
STATE = "FL"
FIELD = "Veterans Park"
FIELD_ID = "a1b2c3d4e5f67890"
HOTEL_ID = "b1b2c3d4e5f67890"
FOOD_ID = "c1b2c3d4e5f67890"
CAFE_ID = "e1b2c3d4e5f67890"
MOTEL_ID = "f1b2c3d4e5f67890"
ADDRESS = "100 Main Street, Probeplace, FL 32000, United States"
FIELD_ADDRESS = "Veterans Park, Probeplace, FL, United States of America"
FIELD_LAT = 30.33
FIELD_LON = -81.65
HOTEL_LAT = 30.34
HOTEL_LON = -81.64


def _sign_in(client: TestClient, subject: str) -> dict[str, str]:
    os.environ["AUTH_INTERNAL_SECRET"] = SECRET
    opened = client.post(
        "/auth/session",
        headers={"X-Internal-Auth": SECRET},
        json={
            "provider": "google",
            "subject": subject,
            "email": f"{subject}@probe-place.test",
            "email_verified": True,
            "display_name": "Probe Place",
            "client": "web",
        },
    )
    assert opened.status_code == 200, opened.text
    headers = {"Authorization": f"Bearer {opened.json()['token']}"}
    accepted = client.post("/auth/terms", json={"version": "ugc-1"}, headers=headers)
    assert accepted.status_code == 200, accepted.text
    return headers


def _tip(
    title: str,
    category: str = "HOTEL",
    place_id: str | None = None,
    formatted_address: str | None = None,
) -> dict[str, object]:
    body: dict[str, object] = {
        "venue_name": FIELD,
        "city": CITY,
        "state": STATE,
        "category": category,
        "title": title,
        "rating": 4,
        "review_text": "Close to the fields.",
        "tags": [],
    }
    if place_id is not None:
        body["place_id"] = place_id
    if formatted_address is not None:
        body["formatted_address"] = formatted_address
    return body


class _Response:
    def __init__(self, payload: dict, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def json(self) -> dict:
        return self._payload


def _geo_payload(lat: float = FIELD_LAT, lon: float = FIELD_LON, formatted: str = FIELD_ADDRESS) -> dict:
    return {
        "results": [
            {
                "lat": lat,
                "lon": lon,
                "formatted": formatted,
                "place_id": FIELD_ID,
                "country_code": "us",
            }
        ]
    }


def _place_feature(place_id: str, name: str, categories: list[str], lat: float = HOTEL_LAT, lon: float = HOTEL_LON) -> dict:
    return {
        "properties": {
            "feature_type": "details",
            "name": name,
            "formatted": ADDRESS,
            "place_id": place_id,
            "lat": lat,
            "lon": lon,
            "categories": categories,
        }
    }


class PlaceLookupTests(unittest.TestCase):
    def setUp(self) -> None:
        Base.metadata.create_all(engine)
        ensure_location_columns()
        os.environ["AUTH_INTERNAL_SECRET"] = SECRET
        self._previous_key = os.environ.get("GEOAPIFY_API_KEY")
        os.environ["GEOAPIFY_API_KEY"] = KEY
        reset_place_rate_limit()
        self.calls: list[dict[str, object]] = []
        self._cleanup()

    def tearDown(self) -> None:
        self._cleanup()
        reset_place_rate_limit()
        if self._previous_key is None:
            os.environ.pop("GEOAPIFY_API_KEY", None)
        else:
            os.environ["GEOAPIFY_API_KEY"] = self._previous_key

    def _cleanup(self) -> None:
        with engine.begin() as connection:
            if connection.execute(text("SELECT to_regclass('public.location_write_event')")).scalar() is not None:
                connection.execute(text("DELETE FROM location_write_event WHERE email LIKE '%@probe-place.test'"))
            if connection.execute(text("SELECT to_regclass('public.venue_tip_vote')")).scalar() is not None:
                connection.execute(
                    text(
                        """
                        DELETE FROM venue_tip_vote
                        WHERE recommendation_id IN (
                            SELECT id FROM venue_recommendation WHERE city = :city OR author_key LIKE 'probe-place-%'
                        )
                        """
                    ),
                    {"city": CITY},
                )
            if connection.execute(text("SELECT to_regclass('public.venue_recommendation')")).scalar() is not None:
                connection.execute(
                    text("DELETE FROM venue_recommendation WHERE city = :city OR author_key LIKE 'probe-place-%'"),
                    {"city": CITY},
                )
            if connection.execute(text("SELECT to_regclass('public.venue_field_point')")).scalar() is not None:
                connection.execute(text("DELETE FROM venue_field_point WHERE city = :city"), {"city": CITY})
            if connection.execute(text("SELECT to_regclass('public.auth_identity')")).scalar() is not None:
                connection.execute(
                    text(
                        """
                        DELETE FROM app_user
                        WHERE id IN (SELECT user_id FROM auth_identity WHERE provider_subject LIKE 'probe-place-%')
                        """
                    )
                )

    def _fake_get(self, url: str, params: dict | None = None, timeout: float | None = None) -> _Response:
        query = dict(params or {})
        self.calls.append({"url": url, "params": query, "timeout": timeout})
        if "geocode/search" in url:
            text_value = str(query.get("text") or "")
            if text_value.startswith("Missing Park"):
                return _Response({"results": []})
            return _Response(_geo_payload())
        if "place-details" in url:
            place_id = str(query.get("id") or "")
            if place_id == FOOD_ID:
                return _Response({"features": [_place_feature(FOOD_ID, "Cafe Probe", ["catering.cafe"])]})
            if place_id == "d1b2c3d4e5f67890":
                return _Response({"features": [_place_feature(place_id, "Far Inn", ["accommodation.hotel"], 40.0, -105.0)]})
            return _Response({"features": [_place_feature(HOTEL_ID, "Hilton Probeplace", ["accommodation.hotel"])]})
        if url.endswith("/places") or "/v2/places" in url:
            categories = str(query.get("categories") or "")
            if "," in categories:
                return _Response({"features": []})
            if str(query.get("name") or "") == "Starbucks":
                if categories != "catering.cafe":
                    return _Response({"features": []})
                return _Response(
                    {
                        "features": [
                            {
                                "properties": {
                                    "name": "Starbucks",
                                    "formatted": ADDRESS,
                                    "address_line1": "100 Main Street",
                                    "city": "Probeplace",
                                    "state_code": "fl",
                                    "postcode": "32000",
                                    "place_id": CAFE_ID,
                                    "lat": HOTEL_LAT,
                                    "lon": HOTEL_LON,
                                    "categories": ["catering.cafe", "catering.cafe.coffee_shop"],
                                }
                            }
                        ]
                    }
                )
            if str(query.get("name") or "") == "Named":
                return _Response(
                    {
                        "features": [
                            {
                                "properties": {
                                    "name": "Hilton Probeplace",
                                    "address_line1": "Hilton Probeplace",
                                    "address_line2": "100 Main Street, Probeplace, FL 32000, United States",
                                    "city": "Probeplace",
                                    "state_code": "fl",
                                    "postcode": "32000",
                                    "formatted": "Hilton Probeplace, 100 Main Street, Probeplace, FL 32000, United States",
                                    "place_id": HOTEL_ID,
                                    "lat": HOTEL_LAT,
                                    "lon": HOTEL_LON,
                                }
                            }
                        ]
                    }
                )
            return _Response(
                {
                    "features": [
                        {
                            "properties": {
                                "name": "Hilton Probeplace",
                                "formatted": ADDRESS,
                                "address_line1": "100 Main Street",
                                "city": "Probeplace",
                                "state_code": "fl",
                                "postcode": "32000",
                                "place_id": HOTEL_ID,
                                "lat": HOTEL_LAT,
                                "lon": HOTEL_LON,
                            }
                        }
                    ]
                }
            )
        raise AssertionError(url)

    def _urls(self) -> list[str]:
        return [str(call["url"]) for call in self.calls]

    def _assert_key_stays_out(self, response_text: str) -> None:
        self.assertNotIn(KEY, response_text)
        self.assertNotIn("apiKey", response_text)
        self.assertNotIn("GEOAPIFY", response_text)
        for call in self.calls:
            self.assertNotIn("apiKey", str(call["url"]))
            params = call["params"]
            self.assertIsInstance(params, dict)
            for name, value in params.items():
                if name == "apiKey":
                    self.assertTrue(value)
                    continue
                self.assertNotIn("secret", str(value).casefold())
                self.assertNotIn("@", str(value))

    def test_category_and_distance_helpers(self) -> None:
        self.assertTrue(category_fits("HOTEL", ()))
        self.assertTrue(category_fits("HOTEL", ("accommodation.hotel",)))
        self.assertFalse(category_fits("HOTEL", ("catering.cafe",)))
        self.assertTrue(category_fits("RESTAURANT", ("catering.fast_food",)))
        self.assertTrue(category_fits("RESTAURANT", ("catering.cafe",)))
        self.assertTrue(category_fits("RESTAURANT", ("catering.cafe.coffee_shop",)))
        self.assertFalse(category_fits("RESTAURANT", ("commercial.supermarket",)))
        self.assertEqual(NEAR_MILES, 20.0)
        self.assertLess(miles_between(FIELD_LAT, FIELD_LON, HOTEL_LAT, HOTEL_LON), NEAR_MILES)
        self.assertGreater(miles_between(FIELD_LAT, FIELD_LON, 40.0, -105.0), NEAR_MILES)

    def test_field_point_is_geocoded_once_and_hides_the_key(self) -> None:
        with TestClient(app) as client, patch("app.places.httpx.get", side_effect=self._fake_get):
            headers = _sign_in(client, "probe-place-field")
            refused = client.get("/locations/field-point", params={"venue_name": FIELD, "city": CITY, "state": STATE})
            self.assertEqual(refused.status_code, 401, refused.text)

            first = client.get(
                "/locations/field-point",
                params={"venue_name": FIELD, "city": CITY, "state": STATE},
                headers=headers,
            )
            self.assertEqual(first.status_code, 200, first.text)
            body = first.json()
            self.assertEqual(body["status"], "found")
            self.assertEqual(body["formatted_address"], FIELD_ADDRESS)
            self.assertEqual(body["venue_key"], make_venue_key(FIELD, CITY, STATE))
            self.assertNotIn("latitude", body)
            self.assertNotIn("longitude", body)
            self.assertIn("query=", body["map_url"])
            self._assert_key_stays_out(first.text)
            geocode = self.calls[0]["params"]
            self.assertIsInstance(geocode, dict)
            self.assertEqual(geocode["text"], f"{FIELD}, {CITY}, {STATE}")
            self.assertEqual(geocode["filter"], "countrycode:us")
            self.assertEqual(set(geocode), {"text", "format", "limit", "filter", "lang", "apiKey"})

            second = client.get(
                "/locations/field-point",
                params={"venue_name": FIELD, "city": CITY, "state": STATE},
                headers=headers,
            )
            self.assertEqual(second.status_code, 200, second.text)
            self.assertEqual(len(self._urls()), 1)

        with Session(engine) as session:
            row = session.get(VenueFieldPoint, make_venue_key(FIELD, CITY, STATE))
            self.assertIsNotNone(row)
            assert row is not None
            self.assertEqual(row.status, "found")
            self.assertEqual(row.provider, "geoapify")
            self.assertEqual(row.latitude, FIELD_LAT)
            self.assertEqual(row.longitude, FIELD_LON)

    def test_tbd_and_a_miss_do_not_retry(self) -> None:
        with TestClient(app) as client, patch("app.places.httpx.get", side_effect=self._fake_get):
            headers = _sign_in(client, "probe-place-tbd")
            skipped = client.get(
                "/locations/field-point",
                params={"venue_name": "TBD", "city": CITY, "state": STATE},
                headers=headers,
            )
            self.assertEqual(skipped.status_code, 200, skipped.text)
            self.assertEqual(skipped.json()["status"], "skipped")
            self.assertIsNone(skipped.json()["formatted_address"])
            self.assertEqual(self.calls, [])
            again = client.get(
                "/locations/field-point",
                params={"venue_name": "TBD - Field 2", "city": CITY, "state": STATE},
                headers=headers,
            )
            self.assertEqual(again.json()["status"], "skipped")
            self.assertEqual(self.calls, [])

            missed = client.get(
                "/locations/field-point",
                params={"venue_name": "Missing Park", "city": CITY, "state": STATE},
                headers=headers,
            )
            self.assertEqual(missed.status_code, 200, missed.text)
            self.assertEqual(missed.json()["status"], "miss")
            repeat = client.get(
                "/locations/field-point",
                params={"venue_name": "Missing Park", "city": CITY, "state": STATE},
                headers=headers,
            )
            self.assertEqual(repeat.json()["status"], "miss")
            self.assertEqual(len(self.calls), 1)

    def test_suggestions_are_biased_to_the_field_and_a_pick_is_stored(self) -> None:
        with TestClient(app) as client, patch("app.places.httpx.get", side_effect=self._fake_get):
            headers = _sign_in(client, "probe-place-save")
            point = client.get(
                "/locations/field-point",
                params={"venue_name": FIELD, "city": CITY, "state": STATE},
                headers=headers,
            )
            self.assertEqual(point.status_code, 200, point.text)
            venue_key = point.json()["venue_key"]

            short = client.get(
                "/locations/places",
                params={"venue_key": venue_key, "category": "HOTEL", "q": "hi", "home_lat": "1", "home_lng": "2"},
                headers=headers,
            )
            self.assertEqual(short.status_code, 200, short.text)
            self.assertEqual(short.json()["suggestions"], [])
            self.assertEqual(len(self.calls), 1)

            hangout = client.get(
                "/locations/places",
                params={"venue_key": venue_key, "category": "COFFEE_GAP", "q": "coffee"},
                headers=headers,
            )
            self.assertEqual(hangout.status_code, 400, hangout.text)

            found = client.get(
                "/locations/places",
                params={"venue_key": venue_key, "category": "HOTEL", "q": "Hilton"},
                headers=headers,
            )
            self.assertEqual(found.status_code, 200, found.text)
            suggestions = found.json()["suggestions"]
            self.assertEqual(len(suggestions), 1)
            self.assertEqual(suggestions[0]["name"], "Hilton Probeplace")
            self.assertEqual(suggestions[0]["formatted_address"], ADDRESS)
            self.assertEqual(suggestions[0]["street"], "100 Main Street")
            self.assertEqual(suggestions[0]["city"], "Probeplace")
            self.assertEqual(suggestions[0]["state"], "FL")
            self.assertEqual(suggestions[0]["postal_code"], "32000")
            self.assertNotIn("latitude", suggestions[0])
            self._assert_key_stays_out(found.text)
            places_call = next(call for call in self.calls if "/v2/places" in str(call["url"]))
            params = places_call["params"]
            self.assertIsInstance(params, dict)
            self.assertEqual(params["name"], "Hilton")
            self.assertEqual(params["categories"], "accommodation.hotel")
            self.assertNotIn(",", str(params["categories"]))
            self.assertEqual(params["bias"], f"proximity:{FIELD_LON:.6f},{FIELD_LAT:.6f}")
            self.assertEqual(SEARCH_RADIUS_METERS, 32187)
            self.assertEqual(params["filter"], f"circle:{FIELD_LON:.6f},{FIELD_LAT:.6f},{SEARCH_RADIUS_METERS}")
            hotel_categories = [
                str(call["params"]["categories"])
                for call in self.calls
                if "/v2/places" in str(call["url"]) and isinstance(call["params"], dict)
            ]
            self.assertEqual(
                hotel_categories,
                ["accommodation.hotel", "accommodation.motel", "accommodation.guest_house"],
            )

            named = client.get(
                "/locations/places",
                params={"venue_key": venue_key, "category": "HOTEL", "q": "Named"},
                headers=headers,
            )
            self.assertEqual(named.status_code, 200, named.text)
            named_hit = named.json()["suggestions"][0]
            self.assertEqual(named_hit["name"], "Hilton Probeplace")
            self.assertEqual(named_hit["street"], "100 Main Street")
            self.assertNotEqual(named_hit["street"], named_hit["name"])
            self.assertIn("accommodation.hotel", str(params["categories"]))
            self.assertNotIn("1.000000", str(params["filter"]))

            plain = client.post("/locations/recommendations", json=_tip("Typed Inn"), headers=headers)
            self.assertEqual(plain.status_code, 200, plain.text)
            self.assertIsNone(plain.json()["matched_name"])
            self.assertIsNone(plain.json()["formatted_address"])
            self.assertIsNone(plain.json()["place_provider"])
            self.assertNotIn("place_id", plain.json())
            self.assertNotIn("latitude", plain.json())
            plain_query = parse_qs(urlparse(plain.json()["map_url"]).query)
            self.assertEqual(plain_query["query"], [f"Typed Inn, {CITY}, {STATE}"])

            saved = client.post(
                "/locations/recommendations",
                json=_tip("hilton", place_id=HOTEL_ID),
                headers=headers,
            )
            self.assertEqual(saved.status_code, 200, saved.text)
            body = saved.json()
            self.assertEqual(body["title"], "hilton")
            self.assertEqual(body["matched_name"], "Hilton Probeplace")
            self.assertEqual(body["formatted_address"], ADDRESS)
            self.assertEqual(body["place_provider"], "geoapify")
            self.assertNotIn("place_id", body)
            self.assertNotIn("latitude", body)
            self.assertNotIn("longitude", body)
            self._assert_key_stays_out(saved.text)
            saved_query = parse_qs(urlparse(body["map_url"]).query)
            self.assertEqual(saved_query["query"], [ADDRESS])

            overridden = client.post(
                "/locations/recommendations",
                json=_tip("hilton typed", place_id=HOTEL_ID, formatted_address="999 Fake Street"),
                headers=headers,
            )
            self.assertEqual(overridden.status_code, 200, overridden.text)
            self.assertEqual(overridden.json()["formatted_address"], ADDRESS)
            self.assertEqual(overridden.json()["place_provider"], "geoapify")

            ignored = client.post(
                "/locations/recommendations",
                json=_tip("Sideline note", category="SIDELINE_TIP", place_id=HOTEL_ID),
                headers=headers,
            )
            self.assertEqual(ignored.status_code, 200, ignored.text)
            self.assertIsNone(ignored.json()["place_provider"])
            self.assertEqual(sum("place-details" in url for url in self._urls()), 2)

        with Session(engine) as session:
            matched = session.scalar(select(VenueRecommendation).where(VenueRecommendation.title == "hilton"))
            self.assertIsNotNone(matched)
            assert matched is not None
            self.assertEqual(matched.place_provider, "geoapify")
            self.assertEqual(matched.place_id, HOTEL_ID)
            self.assertEqual(matched.matched_name, "Hilton Probeplace")
            self.assertEqual(matched.formatted_address, ADDRESS)
            self.assertEqual(matched.latitude, HOTEL_LAT)
            self.assertEqual(matched.longitude, HOTEL_LON)
            self.assertIsNotNone(matched.place_fetched_at)
            history = session.scalar(select(LocationWriteEvent).where(LocationWriteEvent.tip_id == matched.id))
            self.assertIsNotNone(history)
            assert history is not None
            self.assertEqual(history.new_values["matched_name"], "Hilton Probeplace")
            self.assertNotIn(KEY, str(history.new_values))
            sideline = session.scalar(select(VenueRecommendation).where(VenueRecommendation.title == "Sideline note"))
            self.assertIsNotNone(sideline)
            assert sideline is not None
            self.assertIsNone(sideline.place_id)
            self.assertIsNone(sideline.latitude)

    def test_restaurant_search_includes_a_cafe_and_keeps_each_category_separate(self) -> None:
        with TestClient(app) as client, patch("app.places.httpx.get", side_effect=self._fake_get):
            headers = _sign_in(client, "probe-place-cafe")
            point = client.get(
                "/locations/field-point",
                params={"venue_name": FIELD, "city": CITY, "state": STATE},
                headers=headers,
            )
            self.assertEqual(point.status_code, 200, point.text)
            found = client.get(
                "/locations/places",
                params={"venue_key": point.json()["venue_key"], "category": "RESTAURANT", "q": "Starbucks"},
                headers=headers,
            )
            self.assertEqual(found.status_code, 200, found.text)
            suggestions = found.json()["suggestions"]
            self.assertEqual([item["name"] for item in suggestions], ["Starbucks"])
            self.assertEqual(suggestions[0]["place_id"], CAFE_ID)
            self._assert_key_stays_out(found.text)
            categories = [
                str(call["params"]["categories"])
                for call in self.calls
                if "/v2/places" in str(call["url"]) and isinstance(call["params"], dict)
            ]
            self.assertEqual(categories, ["catering.restaurant", "catering.fast_food", "catering.cafe"])

    def test_nearer_place_from_a_later_category_is_listed_first(self) -> None:
        def fake(url: str, params: dict | None = None, timeout: float | None = None) -> _Response:
            query = dict(params or {})
            self.calls.append({"url": url, "params": query, "timeout": timeout})
            categories = str(query.get("categories") or "")
            if categories == "accommodation.hotel":
                feature = _place_feature(HOTEL_ID, "Farther Hyatt", ["accommodation.hotel"])
                feature["properties"]["distance"] = 8000
                return _Response({"features": [feature]})
            if categories == "accommodation.motel":
                feature = _place_feature(MOTEL_ID, "Nearer Hyatt", ["accommodation.motel"])
                feature["properties"]["distance"] = 400
                return _Response({"features": [feature]})
            return _Response({"features": []})

        with patch("app.places.httpx.get", side_effect=fake):
            hits = suggest_places("Hyatt", "HOTEL", FIELD_LAT, FIELD_LON)
        self.assertEqual([hit.name for hit in hits], ["Nearer Hyatt", "Farther Hyatt"])
        self.assertEqual(
            [str(call["params"]["categories"]) for call in self.calls],
            ["accommodation.hotel", "accommodation.motel", "accommodation.guest_house"],
        )

    def test_a_hand_typed_address_is_saved_for_a_hotel_only(self) -> None:
        with TestClient(app) as client:
            headers = _sign_in(client, "probe-place-manual")
            saved = client.post(
                "/locations/recommendations",
                json=_tip("Typed Inn", formatted_address="  12 Oak St, Probeplace, FL 32000  "),
                headers=headers,
            )
            self.assertEqual(saved.status_code, 200, saved.text)
            body = saved.json()
            self.assertEqual(body["formatted_address"], "12 Oak St, Probeplace, FL 32000")
            self.assertIsNone(body["matched_name"])
            self.assertIsNone(body["place_provider"])
            self.assertNotIn("place_id", body)
            self.assertNotIn("latitude", body)
            self._assert_key_stays_out(saved.text)
            saved_query = parse_qs(urlparse(body["map_url"]).query)
            self.assertEqual(saved_query["query"], ["12 Oak St, Probeplace, FL 32000"])

            blank = client.post(
                "/locations/recommendations",
                json=_tip("No Address", formatted_address="   "),
                headers=headers,
            )
            self.assertEqual(blank.status_code, 200, blank.text)
            self.assertIsNone(blank.json()["formatted_address"])

            sideline = client.post(
                "/locations/recommendations",
                json=_tip("Bench", category="SIDELINE_TIP", formatted_address="12 Oak St, Probeplace, FL 32000"),
                headers=headers,
            )
            self.assertEqual(sideline.status_code, 200, sideline.text)
            self.assertIsNone(sideline.json()["formatted_address"])
            self.assertEqual(self.calls, [])

        with Session(engine) as session:
            row = session.scalar(select(VenueRecommendation).where(VenueRecommendation.title == "Typed Inn"))
            self.assertIsNotNone(row)
            assert row is not None
            self.assertEqual(row.formatted_address, "12 Oak St, Probeplace, FL 32000")
            self.assertIsNone(row.place_provider)
            self.assertIsNone(row.place_id)
            self.assertIsNone(row.latitude)
            self.assertIsNone(row.longitude)
            history = session.scalar(select(LocationWriteEvent).where(LocationWriteEvent.tip_id == row.id))
            self.assertIsNotNone(history)
            assert history is not None
            self.assertEqual(history.new_values["formatted_address"], "12 Oak St, Probeplace, FL 32000")
            self.assertNotIn("place_id", history.new_values)
            parked = session.scalar(select(VenueRecommendation).where(VenueRecommendation.title == "Bench"))
            self.assertIsNotNone(parked)
            assert parked is not None
            self.assertIsNone(parked.formatted_address)

    def test_a_far_or_wrong_place_is_not_stored(self) -> None:
        with TestClient(app) as client, patch("app.places.httpx.get", side_effect=self._fake_get):
            headers = _sign_in(client, "probe-place-far")
            client.get(
                "/locations/field-point",
                params={"venue_name": FIELD, "city": CITY, "state": STATE},
                headers=headers,
            )
            unknown = client.post(
                "/locations/recommendations",
                json=_tip("Nope", place_id="not a place"),
                headers=headers,
            )
            self.assertEqual(unknown.status_code, 400, unknown.text)
            self.assertNotIn(KEY, unknown.text)
            cafe = client.post(
                "/locations/recommendations",
                json=_tip("Cafe", place_id=FOOD_ID),
                headers=headers,
            )
            self.assertEqual(cafe.status_code, 400, cafe.text)
            far = client.post(
                "/locations/recommendations",
                json=_tip("Far", place_id="d1b2c3d4e5f67890"),
                headers=headers,
            )
            self.assertEqual(far.status_code, 400, far.text)
            self.assertIn("typed", far.json()["detail"])

        with Session(engine) as session:
            rows = list(session.scalars(select(VenueRecommendation).where(VenueRecommendation.city == CITY)).all())
        self.assertEqual(rows, [])

    def test_upstream_failure_hides_the_key_and_the_limit_is_per_account(self) -> None:
        def explode(url: str, params: dict | None = None, timeout: float | None = None) -> _Response:
            raise httpx.ConnectError(f"failed {url}?apiKey={KEY}")

        with TestClient(app) as client, patch("app.places.httpx.get", side_effect=explode):
            headers = _sign_in(client, "probe-place-down")
            failed = client.get(
                "/locations/field-point",
                params={"venue_name": FIELD, "city": CITY, "state": STATE},
                headers=headers,
            )
            self.assertEqual(failed.status_code, 503, failed.text)
            self.assertEqual(failed.json()["detail"], "Place lookup is unavailable")
            self.assertNotIn(KEY, failed.text)
            self.assertNotIn("apiKey", failed.text)

        os.environ["GEOAPIFY_API_KEY"] = ""
        with TestClient(app) as client, patch("app.places.httpx.get", side_effect=self._fake_get):
            headers = _sign_in(client, "probe-place-nokey")
            missing = client.get(
                "/locations/field-point",
                params={"venue_name": FIELD, "city": CITY, "state": STATE},
                headers=headers,
            )
            self.assertEqual(missing.status_code, 503, missing.text)
            self.assertNotIn("GEOAPIFY", missing.text)
            self.assertEqual(self.calls, [])
        os.environ["GEOAPIFY_API_KEY"] = KEY

        with TestClient(app) as client, patch("app.places.httpx.get", side_effect=self._fake_get), patch(
            "app.places.PLACE_LIMIT", 1
        ):
            headers = _sign_in(client, "probe-place-limit")
            first = client.get(
                "/locations/field-point",
                params={"venue_name": FIELD, "city": CITY, "state": STATE},
                headers=headers,
            )
            self.assertEqual(first.status_code, 200, first.text)
            blocked = client.get(
                "/locations/field-point",
                params={"venue_name": "Other Park", "city": CITY, "state": STATE},
                headers=headers,
            )
            self.assertEqual(blocked.status_code, 429, blocked.text)
            self.assertNotIn(KEY, blocked.text)
            cached = client.get(
                "/locations/field-point",
                params={"venue_name": FIELD, "city": CITY, "state": STATE},
                headers=headers,
            )
            self.assertEqual(cached.status_code, 200, cached.text)
            self.assertEqual(len(self.calls), 1)
