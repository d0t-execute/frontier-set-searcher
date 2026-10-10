import etl


def test_package_is_importable() -> None:
    assert etl.__doc__ is not None
