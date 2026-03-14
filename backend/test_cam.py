import asyncio
import logging
from app.services.camera_service import camera_service

logging.basicConfig(level=logging.DEBUG)

def test():
    cams = camera_service.fetch_cameras_for_district(7)
    print("Found cameras:", len(cams))
    if cams:
        print("First camera:", cams[0].to_dict())

if __name__ == "__main__":
    test()
