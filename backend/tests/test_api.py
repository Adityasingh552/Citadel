"""Tests for the Citadel API endpoints."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.database import Base, get_db


# Test database setup
TEST_DB_URL = "sqlite:///./test_citadel.db"
engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestSession()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(autouse=True)
def setup_db():
    """Create tables before each test, drop after."""
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


client = TestClient(app, raise_server_exceptions=False)


class TestHealthCheck:
    def test_health(self):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "healthy"
        assert "version" in data


class TestEvents:
    def test_list_events_empty(self):
        resp = client.get("/api/events")
        assert resp.status_code == 200
        data = resp.json()
        assert data["events"] == []
        assert data["total"] == 0

    def test_get_event_not_found(self):
        resp = client.get("/api/events/nonexistent-id")
        assert resp.status_code == 404


class TestTickets:
    def test_list_tickets_empty(self):
        resp = client.get("/api/tickets")
        assert resp.status_code == 200
        data = resp.json()
        assert data["tickets"] == []
        assert data["total"] == 0

    def test_get_ticket_not_found(self):
        resp = client.get("/api/tickets/nonexistent-id")
        assert resp.status_code == 404


class TestStats:
    def test_stats_empty(self):
        resp = client.get("/api/stats")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_events"] == 0
        assert data["total_accidents"] == 0
        assert "severity_breakdown" in data
        assert "timeline_24h" in data


class TestSettings:
    def test_get_settings(self):
        resp = client.get("/api/settings")
        assert resp.status_code == 200
        data = resp.json()
        assert "confidence_threshold" in data
        assert "model_name" in data

    def test_update_settings(self):
        resp = client.put("/api/settings", json={"confidence_threshold": 0.8})
        assert resp.status_code == 200
        data = resp.json()
        assert data["confidence_threshold"] == 0.8
