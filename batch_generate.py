import argparse
import json
import logging
import os
from multiprocessing import Pool

from backend import generate_hexa_flock, stamp_service


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

os.makedirs("flocks", exist_ok=True)


def process_seed(seed: int) -> int:
    img_bytes, meta = generate_hexa_flock(seed)
    stamp_data = {
        "name": f"HexaFlock #{seed}",
        "description": meta["description"],
        "image_base64": meta["image_uri"].split(",", 1)[1],
        "attributes": {**meta["traits"], "seed": seed},
    }
    tx_hash = stamp_service.create_stamp(stamp_data)

    with open(f"flocks/flock_{seed}.png", "wb") as f:
        f.write(img_bytes.getvalue())

    with open(f"flocks/meta_{seed}.json", "w") as f:
        json.dump({**meta, "tx_hash": tx_hash}, f, indent=2)

    logger.info(f"Processed seed={seed} tx={tx_hash}")
    return seed


def main():
    parser = argparse.ArgumentParser(description="Batch generate and (mock) stamp HexaFlocks")
    parser.add_argument("--num", type=int, default=10, help="Number of flocks to generate")
    parser.add_argument("--processes", type=int, default=2, help="Parallel processes for generation")
    args = parser.parse_args()

    seeds = list(range(1, args.num + 1))
    if args.processes <= 1:
        for s in seeds:
            process_seed(s)
    else:
        with Pool(processes=args.processes) as pool:
            pool.map(process_seed, seeds)

    logger.info("Batch complete: %d flocks", args.num)


if __name__ == "__main__":
    main()

