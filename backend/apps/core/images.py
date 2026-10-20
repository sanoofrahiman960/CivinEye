"""Image upload validation and processing.

Every uploaded photo is opened with Pillow (rejecting anything that is not a real JPEG, PNG or
WebP image), auto-rotated, resized, and re-encoded as JPEG. Re-encoding strips EXIF metadata such
as the camera's GPS position and device details, so private metadata never reaches public views.
"""
import io
import uuid
import warnings

from django.conf import settings
from django.core.files.base import ContentFile
from PIL import Image, ImageOps, UnidentifiedImageError
from rest_framework.exceptions import ValidationError

ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
MAX_DIMENSION = 2048
THUMBNAIL_DIMENSION = 480
MAX_PIXELS = 40_000_000


class ProcessedImage:
    def __init__(self, image, thumbnail, perceptual_hash):
        self.image = image
        self.thumbnail = thumbnail
        self.perceptual_hash = perceptual_hash


def dhash(img, hash_size=8):
    """Difference hash: 64-bit perceptual fingerprint as a 16-character hex string."""
    gray = img.convert("L").resize((hash_size + 1, hash_size), Image.Resampling.LANCZOS)
    pixels = list(gray.getdata())
    bits = 0
    for row in range(hash_size):
        for col in range(hash_size):
            left = pixels[row * (hash_size + 1) + col]
            right = pixels[row * (hash_size + 1) + col + 1]
            bits = (bits << 1) | (1 if left > right else 0)
    return f"{bits:016x}"


def hamming_distance(hash_a, hash_b):
    return bin(int(hash_a, 16) ^ int(hash_b, 16)).count("1")


def _encode_jpeg(img, quality=85):
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=quality, optimize=True)
    return buffer.getvalue()


def process_upload(uploaded_file):
    max_bytes = settings.MAX_IMAGE_SIZE_MB * 1024 * 1024
    if uploaded_file.size > max_bytes:
        raise ValidationError({"images": [f"Each image must be {settings.MAX_IMAGE_SIZE_MB} MB or smaller."]})

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            uploaded_file.seek(0)
            probe = Image.open(uploaded_file)
            if probe.format not in ALLOWED_FORMATS:
                raise ValidationError({"images": ["Only JPEG, PNG or WebP images are allowed."]})
            if probe.width * probe.height > MAX_PIXELS:
                raise ValidationError({"images": ["Image dimensions are too large."]})
            probe.verify()

            uploaded_file.seek(0)
            img = Image.open(uploaded_file)
            img.load()
    except ValidationError:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombWarning, Image.DecompressionBombError):
        raise ValidationError({"images": ["The file is not a valid image."]})

    img = ImageOps.exif_transpose(img).convert("RGB")
    img.thumbnail((MAX_DIMENSION, MAX_DIMENSION))
    perceptual_hash = dhash(img)

    thumb = img.copy()
    thumb.thumbnail((THUMBNAIL_DIMENSION, THUMBNAIL_DIMENSION))

    name = uuid.uuid4().hex
    return ProcessedImage(
        image=ContentFile(_encode_jpeg(img), name=f"{name}.jpg"),
        thumbnail=ContentFile(_encode_jpeg(thumb, quality=75), name=f"{name}_thumb.jpg"),
        perceptual_hash=perceptual_hash,
    )


def validate_image_count(files, max_count, required=False):
    if required and not files:
        raise ValidationError({"images": ["At least one photograph is required."]})
    if len(files) > max_count:
        raise ValidationError({"images": [f"You can upload at most {max_count} images at a time."]})
