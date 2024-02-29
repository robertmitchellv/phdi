import pytest
from app.services import save_to_db_payload
from fastapi import HTTPException
from requests.models import Response


# TODO: Update this test once save_to_db is created as an actual
# endpoint, but for now, don't mess with the structure as this is
# needed for compatibility with the demo UI.
def test_save_to_db_payload():
    response = Response()
    response.status_code = 200
    response._content = b'{"bundle": {"entry": [{"resource": {"id": "foo"}}]}}'
    result = save_to_db_payload(bundle=response)
    expected_result = {
        "ecr_id": "foo",
        "data": {"entry": [{"resource": {"id": "foo"}}]},
    }
    assert result == expected_result


# TODO: Update this test once save_to_db is created as an actual
# endpoint, but for now, don't mess with the structure as this is
# needed for compatibility with the demo UI.
def test_save_to_db_failure_missing_eicr_id():
    response = Response()
    response.status_code = 200
    response._content = b'{"bundle": "bar", "parsed_values":{}}'

    with pytest.raises(HTTPException) as exc_info:
        save_to_db_payload(bundle=response)

    assert exc_info.value.status_code == 422
