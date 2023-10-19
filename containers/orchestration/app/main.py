from phdi.containers.base_service import BaseService
from fastapi import (
    Response,
    status,
    Body,
    UploadFile,
    Form,
    Request,
    File,
    HTTPException,
    WebSocket,
)
from typing import Annotated, Optional
from pathlib import Path
from zipfile import is_zipfile, ZipFile
from app.utils import load_processing_config, unzip, load_config_assets
from app.config import get_settings
from app.services import call_apis
from app.models import (
    GetConfigResponse,
    ProcessingConfigModel,
    PutConfigResponse,
    ProcessMessageResponse,
    ListConfigsResponse,
)
from app.constants import (
    upload_config_response_examples,
    sample_get_config_response,
    process_message_response_examples,
    sample_list_configs_response,
)
import json
import io
import os
import asyncio
from icecream import ic

# import websockets

# Read settings immediately to fail fast in case there are invalid values.
get_settings()

# Instantiate FastAPI via PHDI's BaseService class
app = BaseService(
    service_name="PHDI Orchestration",
    description_path=Path(__file__).parent.parent / "description.md",
).start()


upload_config_response = load_config_assets(
    upload_config_response_examples, PutConfigResponse
)


class WS_File:
    # Constructor method (init method)
    def __init__(self, file):
        # Instance attributes
        self.file = file


async def process_form(websocket, form_data):
    # Simulate processing the form data with progress updates
    for i in range(1, 11):
        progress = i * 10  # Progress percentage
        progress_dict = {"progress": progress}
        await websocket.send_text(json.dumps(progress_dict))
        # await websocket.send('{"progress": ' + str(progress) + ', "type": "json }')
        await asyncio.sleep(1)  # Simulate work


def unzip_if_zipped(upload_file=None, data=None):

    if upload_file and is_zipfile(upload_file.file):
        return unzip(upload_file)
    elif upload_file:
        return upload_file.file
    else:
        content = data["message"]
        return content


@app.websocket("/process-ws")
async def process_message_endpoint_ws(
    websocket: WebSocket,
) -> ProcessMessageResponse:
    """
    Processes a message either as a message parameter or an uploaded zip file
      through a series of microservices
    """

    await websocket.accept()
    while True:
        file = await websocket.receive_bytes()
        ic(file)
        zf = ZipFile(io.BytesIO(file), "r")

        # with open(file, 'rb') as file_data:
        #     bytes_content = file_data.read()
        ic(zf.filelist)
        unzippy = unzip(zf)
        ic(unzippy)

        input = {
            "message_type": "eicr",
            "include_error_types": "errors",
            "message": unzippy,
        }
        processing_config = load_processing_config("sample-orchestration-config.json")
        call_apis(config=processing_config, input=input)

        await process_form(websocket, file)


@app.post("/process", status_code=200, responses=process_message_response_examples)
async def process_message_endpoint(
    request: Request,
    message_type: Optional[str] = Form(None),
    include_error_types: Optional[str] = Form(None),
    upload_file: Optional[UploadFile] = File(None),
) -> ProcessMessageResponse:
    """
    Processes a message either as a message parameter or an uploaded zip file
      through a series of microservices
    """
    content = ""

    try:
        data = await request.json()
        content = unzip_if_zipped(upload_file, data)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON data: {str(e)}")
    except KeyError as e:
        error_message = str(e)
        raise HTTPException(
            status_code=400, detail=f"Missing JSON data: {error_message}"
        )

    message_type = data["message_type"]
    include_error_types = data["include_error_types"]

    # Change below to grab from uploaded configs once we've got them
    processing_config = load_processing_config("sample-orchestration-config.json")
    input = {
        "message_type": message_type,
        "include_error_types": include_error_types,
        "message": content,
    }

    response, responses = call_apis(config=processing_config, input=input)

    if response.status_code == 200:
        # Parse and work with the API response data (JSON, XML, etc.)
        api_data = response.json()  # Assuming the response is in JSON format
        return {
            "message": "Processing succeeded!",
            "processed_values": api_data,
        }
    else:
        return {
            "message": f"Request failed with status code {response.status_code}",
            "responses": f"{responses}",
            "processed_values": "",
        }


@app.get("/configs", responses=sample_list_configs_response)
async def list_configs() -> ListConfigsResponse:
    """
    Get a list of all the process configs currently available. Default configs are ones
    that are packaged by default with this service. Custom configs are any additional
    config that users have chosen to upload to this service (this feature is not yet
    implemented)
    """
    default_configs = os.listdir(Path(__file__).parent / "default_configs")
    custom_configs = os.listdir(Path(__file__).parent / "custom_configs")
    custom_configs = [config for config in custom_configs if config != ".keep"]
    configs = {"default_configs": default_configs, "custom_configs": custom_configs}
    return configs


@app.get(
    "/configs/{processing_config_name}",
    status_code=200,
    responses=sample_get_config_response,
)
async def get_config(
    processing_config_name: str, response: Response
) -> GetConfigResponse:
    """
    Get the config specified by 'processing_config_name'.
    """
    try:
        processing_config = load_processing_config(processing_config_name)
    except FileNotFoundError as error:
        response.status_code = status.HTTP_400_BAD_REQUEST
        return {"message": error.__str__(), "processing_config": {}}
    return {"message": "Config found!", "processing_config": processing_config}


@app.put(
    "/configs/{processing_config_name}",
    status_code=200,
    response_model=PutConfigResponse,
    responses=upload_config_response,
)
async def upload_config(
    processing_config_name: str,
    input: Annotated[ProcessingConfigModel, Body(examples=upload_config_response)],
    response: Response,
) -> PutConfigResponse:
    """
    Upload a new processing config to the service or update an existing config.
    """

    file_path = Path(__file__).parent / "custom_configs" / processing_config_name
    config_exists = file_path.exists()
    if config_exists and not input.overwrite:
        response.status_code = status.HTTP_400_BAD_REQUEST
        return {
            "message": f"A config for the name '{processing_config_name}' already "
            "exists. To proceed submit a new request with a different config name or "
            "set the 'overwrite' field to 'true'."
        }

    # Convert Pydantic models to dicts so they can be serialized to JSON.
    for field in input.processing_config:
        input.processing_config[field] = input.processing_config[field].dict()

    with open(file_path, "w") as file:
        json.dump(input.processing_config, file, indent=4)

    if config_exists:
        return {"message": "Config updated successfully!"}
    else:
        response.status_code = status.HTTP_201_CREATED
        return {"message": "Config uploaded successfully!"}
